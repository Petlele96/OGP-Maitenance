import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PLANS, type PlanId, isSubscriberPlan } from "./plans";
import { groupByBlock } from "./sort";
import { nextDebitDate } from "./billing";
import {
  toDateKey,
  visitDaysForSlotInMonth,
  candidateSlotForDate,
  addWorkingDays,
  nextWorkingDay,
  nowInJohannesburg,
  nextServiceDate,
  nextOccurrenceForSlot,
  suggestNextServiceDate,
  isDateDriven,
  effectiveDueDate,
  dueStatusOn,
  isWorkingDay,
  MIN_NOTICE_WORKING_DAYS,
  MOVED_REASON,
  BLOCKED_REASON,
  SLOT_COUNT,
  type SkipReason,
  type SkipOrMoveReason,
} from "./schedule";

/**
 * SQL for "midnight on the 1st of the current month, Johannesburg time" as an explicit
 * timestamptz. Written as a double AT TIME ZONE conversion (naive-local -> instant)
 * rather than relying on the session's timezone setting, because PgBouncer's
 * transaction-pooling mode (what DATABASE_URL/POSTGRES_URL point at in production)
 * doesn't reliably preserve a `SET timezone` across pooled connections - see the
 * `pool.on("connect", ...)` note below, which covers current_date/now() elsewhere but
 * can't be trusted for these boundary comparisons.
 */
const SAST_MONTH_START_SQL =
  "(date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("Missing DATABASE_URL (or POSTGRES_URL)");
  // Uses the pooled connection string (PgBouncer transaction mode) - fine here since we
  // only ever issue single unnamed parameterized statements, no server-side prepares.
  // sslmode rewritten to no-verify / rejectUnauthorized: false - Supabase's pooler
  // presents a cert chain that isn't fully verifiable; the connection is still
  // TLS-encrypted, just without full chain verification.
  const connectionString = url.replace(/([?&])sslmode=[^&]*/, "$1sslmode=no-verify");
  pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: false } });
  // Belt-and-suspenders alongside `alter database ... set timezone` in schema.sql - makes
  // every connection explicitly Africa/Johannesburg regardless of what the pooler hands
  // back, so current_date/now() never silently drift onto UTC's calendar day.
  pool.on("connect", (client) => {
    client.query("set timezone = 'Africa/Johannesburg'").catch(() => {});
  });
  return pool;
}

export interface SignupRow {
  id: string;
  full_name: string;
  house_number: string;
  whatsapp_number: string;
  plan: PlanId;
  amount: string;
  start_date: string | null;
  payment_status: "booked" | "pending" | "active" | "failed" | "cancelled" | "archived";
  payfast_subscription_token: string | null;
  payfast_m_payment_id: string;
  service_slot: number | null;
  cancelled_at: string | null;
  last_payment_failed_at: string | null;
  terms_accepted_at: string;
  block: number | null;
  scheduled_visit_date: string | null;
  welcomed_at: string | null;
  payment_link_token: string | null;
  payment_link_expires_at: string | null;
  payment_link_sent_at: string | null;
  payment_method: "payfast" | "eft" | "cash";
  payment_timing: "pay_now" | "pay_after_service";
  notes: string | null;
  paused_at: string | null;
  tracking_token: string;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * True if this WhatsApp number already has an active OR booked monthly/annual
 * subscription. Scoped to subscriptions (not once-off) deliberately - a subscriber
 * booking an extra once-off job, or a past once-off customer booking another one, is
 * normal repeat business, not an accidental double-signup. Preventing two parallel
 * *subscriptions* on the same number is what actually avoids double-billing (or
 * double-booking) the same household - 'booked' counts here too, since letting someone
 * book twice before ever paying is the same accidental-duplicate problem.
 */
export async function hasExistingSubscription(whatsappNumber: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `select exists(
       select 1 from signups
       where whatsapp_number = $1 and payment_status in ('active', 'booked') and plan in ('monthly', 'annual')
     ) as exists`,
    [whatsappNumber]
  );
  return rows[0].exists;
}

interface InsertSignupInput {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  amount: number;
  block: number | null;
  paymentStatus: "pending" | "booked";
  paymentTiming: "pay_now" | "pay_after_service";
}

/**
 * Shared by createSignup (pay now) and createBooking (pay later, see lib/db.ts's
 * `generatePaymentLink`) - both need the exact same slot-assignment and row shape, only
 * the initial payment_status differs. A booked row's `id` still becomes its
 * payfast_m_payment_id up front, so whenever it's eventually paid (immediately or via a
 * payment link days later) the ITN handler finds and activates the same row with zero
 * special-casing.
 */
async function insertSignup(input: InsertSignupInput): Promise<SignupRow> {
  const id = randomUUID();
  const { workingDays } = await getAppSettings();
  const now = nowInJohannesburg();
  // No subscriber is given a service day on booking, whatever they chose or paid: monthly and annual customers are
  // created "to be scheduled" (no slot, no next service date) and the owner assigns the date from the dashboard.
  // Once-off bookings don't recur, so they have no slot either.
  // A booked once-off gets its service day reserved up front too, same as monthly/annual
  // get their slot at booking time - "given a service day" shouldn't depend on which plan
  // was picked. The direct pay-now once-off flow is untouched: it still waits for
  // bookOnceOffVisit at ITN completion (see there), since payment is immediate anyway.
  const scheduledVisitDate =
    !isSubscriberPlan(input.plan) && input.paymentStatus === "booked"
      ? toDateKey(addWorkingDays(now, MIN_NOTICE_WORKING_DAYS, workingDays))
      : null;
  // terms_accepted_at is set unconditionally here, not passed in - the API route only
  // ever calls this after the zod schema has confirmed agreedToTerms === true.
  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id, service_slot, terms_accepted_at, block, payment_status, scheduled_visit_date, next_service_date, routing_from, payment_timing)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12::date, $13::date, $14)
     returning *`,
    [
      id,
      input.fullName,
      input.houseNumber,
      input.whatsappNumber,
      input.plan,
      input.amount,
      id,
      null,
      input.block,
      input.paymentStatus,
      scheduledVisitDate,
      null,
      null,
      input.paymentTiming,
    ]
  );
  return rows[0];
}

/** Direct signup-and-pay-now: card via PayFast, activates when the payment completes. */
export async function createSignup(
  input: Omit<InsertSignupInput, "paymentStatus" | "paymentTiming">
): Promise<SignupRow> {
  return insertSignup({ ...input, paymentStatus: "pending", paymentTiming: "pay_now" });
}

/**
 * "Book now, pay after your first service": no PayFast interaction yet. The customer is 'booked' (awaiting
 * payment) with no service day - the owner assigns one - and a payment link is sent once their first visit is done.
 */
export async function createBooking(
  input: Omit<InsertSignupInput, "paymentStatus" | "paymentTiming">
): Promise<SignupRow> {
  return insertSignup({ ...input, paymentStatus: "booked", paymentTiming: "pay_after_service" });
}

export async function getSignup(id: string): Promise<SignupRow | null> {
  const { rows } = await getPool().query<SignupRow>("select * from signups where id = $1 limit 1", [id]);
  return rows[0] ?? null;
}

export async function getSignupByMPaymentId(mPaymentId: string): Promise<SignupRow | null> {
  const { rows } = await getPool().query<SignupRow>(
    "select * from signups where payfast_m_payment_id = $1 limit 1",
    [mPaymentId]
  );
  return rows[0] ?? null;
}

export async function getSignupByPaymentLinkToken(token: string): Promise<SignupRow | null> {
  const { rows } = await getPool().query<SignupRow>(
    "select * from signups where payment_link_token = $1 limit 1",
    [token]
  );
  return rows[0] ?? null;
}

export interface PaymentLink {
  token: string;
  expiresAt: string;
  fullName: string;
  whatsappNumber: string;
  plan: PlanId;
}

/**
 * Issues (or re-issues) a 7-day payment link token for a booked customer - the "Send
 * payment link" button on the ops page calls this fresh every time, so a lost or expired
 * link is always replaceable rather than a dead end. Only ever touches a still-'booked'
 * row: once a customer is active, "resending" a link for them is a no-op (returns null).
 * Returns the bits the caller needs to build the WhatsApp message, so it doesn't need a
 * second lookup.
 */
export async function generatePaymentLink(signupId: string): Promise<PaymentLink | null> {
  const token = randomUUID();
  const { rows } = await getPool().query<{
    payment_link_token: string;
    payment_link_expires_at: string;
    full_name: string;
    whatsapp_number: string;
    plan: PlanId;
  }>(
    `update signups
     set payment_link_token = $2,
         payment_link_expires_at = now() + interval '7 days',
         payment_link_sent_at = now(),
         updated_at = now()
     where id = $1 and payment_status = 'booked'
     returning payment_link_token, payment_link_expires_at::text, full_name, whatsapp_number, plan`,
    [signupId, token]
  );
  if (!rows[0]) return null;
  return {
    token: rows[0].payment_link_token,
    expiresAt: rows[0].payment_link_expires_at,
    fullName: rows[0].full_name,
    whatsappNumber: rows[0].whatsapp_number,
    plan: rows[0].plan,
  };
}

export async function activateSignup(id: string, subscriptionToken: string | null): Promise<void> {
  await getPool().query(
    `update signups
     set payment_status = 'active',
         start_date = coalesce(start_date, (now() at time zone 'Africa/Johannesburg')::date),
         payfast_subscription_token = coalesce($2, payfast_subscription_token),
         last_payment_failed_at = null,
         updated_at = now()
     where id = $1`,
    [id, subscriptionToken]
  );
}

export async function markSignupFailed(id: string): Promise<void> {
  await getPool().query(
    "update signups set payment_status = 'failed', updated_at = now() where id = $1 and payment_status = 'pending'",
    [id]
  );
}

/**
 * A recurring charge failed on an otherwise-active subscription. Deliberately does NOT
 * change payment_status - they stay 'active' (still on the /ops schedule, still get
 * serviced) but show up on the owner dashboard's chase list via last_payment_failed_at.
 */
export async function markPaymentFailed(id: string): Promise<void> {
  await getPool().query(
    "update signups set last_payment_failed_at = now(), updated_at = now() where id = $1 and payment_status = 'active'",
    [id]
  );
}

/** True cancellation (not a failed charge) - takes them off the schedule. Only affects still-'active' rows. */
export async function cancelSignup(id: string): Promise<void> {
  await getPool().query(
    `update signups
     set payment_status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = $1 and payment_status = 'active'`,
    [id]
  );
}

/**
 * Books a once-off visit MIN_NOTICE_WORKING_DAYS out, once payment completes - the same
 * minimum notice a subscriber's first visit gets, so a once-off customer isn't sprung on
 * the operator (or the customer) with no warning. No capacity model beyond that - it
 * just joins that day's list alongside whoever else is already on it, same as the
 * existing recurring scheduler does for any given day. Only sets it the first time
 * (won't move an already-booked date on a retried ITN).
 */
export async function bookOnceOffVisit(id: string): Promise<void> {
  const { workingDays } = await getAppSettings();
  const firstVisitDate = toDateKey(addWorkingDays(nowInJohannesburg(), MIN_NOTICE_WORKING_DAYS, workingDays));
  await getPool().query(
    `update signups
     set scheduled_visit_date = coalesce(scheduled_visit_date, $2::date),
         updated_at = now()
     where id = $1`,
    [id, firstVisitDate]
  );
}

/**
 * Idempotent via pf_payment_id's unique constraint - safe if PayFast retries an ITN.
 * pf_payment_id (PayFast's own transaction id) should always be present, but Postgres
 * never treats two NULLs as conflicting under a unique constraint - if it were ever
 * missing, inserting with a bare null would let a retried ITN double-count revenue
 * instead of being deduped. Falling back to the ITN's own signature closes that gap: an
 * MD5 over the whole notification, it's identical across genuine retries of the same
 * notification and differs across real transactions (different amount/date/ids feed the
 * hash), so it's a safe substitute idempotency key for this rare case.
 */
export async function recordPayment(
  signupId: string,
  amount: number,
  pfPaymentId: string | null,
  itnSignature: string
): Promise<void> {
  const dedupeKey = pfPaymentId ?? `sig:${itnSignature}`;
  await getPool().query(
    `insert into payments (signup_id, amount, pf_payment_id)
     values ($1, $2, $3)
     on conflict (pf_payment_id) do nothing`,
    [signupId, amount, dedupeKey]
  );
}

export interface ServiceVisitRow {
  signup_id: string;
  service_date: string;
  completed_at: string;
}

/**
 * Signups due on any of the given dates - subscribers via their recurring service_slot
 * (candidateSlotForDate), once-off bookings via their single scheduled_visit_date, and
 * anyone bumped onto one of these dates by a "Can't do" skip (skipped_visits.rescheduled_date).
 * These three never double-match the same row for the same visit (a subscriber's
 * scheduled_visit_date is always null, a once-off's service_slot is always null, and a
 * skip's rescheduled_date is a fresh one-off date), so a customer appears at most once per
 * date even though up to three conditions could technically be true. Unordered - callers
 * sort/group with lib/sort.ts (a plain SQL text order misorders numeric house numbers).
 *
 * Includes 'booked' alongside 'active' - a booked customer already has a real reserved day
 * (assigned at booking time, same as anyone else), and payment confirmation has nothing to
 * do with whether they should show up, be movable, or be markable done. Only 'pending' and
 * 'failed' (an abandoned or unconfirmed signup attempt, not a real relationship yet) and
 * 'cancelled' stay excluded.
 */
export type PooledSignup = SignupRow & { next_due_key: string | null; routing_from_key: string | null };

export async function getActiveVisitsForDates(dates: string[]): Promise<PooledSignup[]> {
  if (dates.length === 0) return [];
  const slots = Array.from(
    new Set(
      dates
        .map((d) => candidateSlotForDate(new Date(`${d}T00:00:00`)))
        .filter((s): s is number => s !== null)
    )
  );
  const { rows } = await getPool().query<PooledSignup>(
    `select *, next_service_date::text as next_due_key, routing_from::text as routing_from_key from signups
     where payment_status in ('active', 'booked')
       and paused_at is null
       and (
         service_slot = any($1::int[])
         or scheduled_visit_date = any($2::date[])
         or exists (
           select 1 from skipped_visits sv
           where sv.signup_id = signups.id and sv.rescheduled_date = any($2::date[])
         )
         or (plan <> 'once-off' and next_service_date is not null and routing_from is not null)
       )`,
    [slots, dates]
  );
  return rows;
}

/** service_date cast to text so pg returns a plain 'YYYY-MM-DD' string, not a Date object. */
export async function getVisitsForDates(dates: string[]): Promise<ServiceVisitRow[]> {
  if (dates.length === 0) return [];
  const { rows } = await getPool().query<ServiceVisitRow>(
    `select signup_id, service_date::text, completed_at
     from service_visits
     where service_date = any($1::date[])`,
    [dates]
  );
  return rows;
}

export type YardStatus = "done" | "not_done" | "pending";

export interface DayYard {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  plan: PlanId;
  notes: string | null;
  /** 'pending' = nothing recorded yet - treated as "assume done" until the day is confirmed. */
  status: YardStatus;
  completedAt: string | null;
  reason: SkipOrMoveReason | null;
  rescheduledDate: string | null;
  /** Set when the client's due date is before this day (the day it was due) - they sit at the top, marked overdue. */
  overdueSince: string | null;
  /** True when the client is routed by their next service date rather than the old fixed slot. */
  driven: boolean;
}

interface RoutePoolRow {
  id: string;
  full_name: string;
  house_number: string;
  whatsapp_number: string;
  block: number | null;
  plan: PlanId;
  notes: string | null;
  payment_status: SignupRow["payment_status"];
  service_slot: number | null;
  scheduled_visit_date: string | null;
  next_service_date: string | null;
  routing_from: string | null;
  created_date: string;
  paused_date: string | null;
  cancelled_date: string | null;
}

export interface RoutingContext {
  workingDays: number[];
  blocked: Set<string>;
}

/** Working days and blocked dates - what decides whether a due date lands on a day the crew actually works. */
async function getRoutingContext(): Promise<RoutingContext> {
  const [{ workingDays }, blocked] = await Promise.all([getAppSettings(), getBlockedDateSet()]);
  return { workingDays, blocked };
}

let routingContextCache: { at: number; value: RoutingContext } | null = null;
/** Same, remembered for a few seconds - for loops that look up one customer at a time (owner dashboard). */
async function getRoutingContextCached(): Promise<RoutingContext> {
  if (routingContextCache && Date.now() - routingContextCache.at < 5000) return routingContextCache.value;
  const value = await getRoutingContext();
  routingContextCache = { at: Date.now(), value };
  return value;
}

type DrivenSkips = Map<string, { original_date: string; rescheduled_date: string }[]>;

/** Moves/flags made on or after each date-driven client's next service date - they decide the date the client is really due. */
async function getDrivenSkips(): Promise<DrivenSkips> {
  const { rows } = await getPool().query<{ signup_id: string; original_date: string; rescheduled_date: string }>(
    `select sv.signup_id, sv.original_date::text, sv.rescheduled_date::text
     from skipped_visits sv join signups s on s.id = sv.signup_id
     where s.next_service_date is not null and sv.original_date >= s.next_service_date`
  );
  const map: DrivenSkips = new Map();
  for (const r of rows) {
    const list = map.get(r.signup_id) ?? [];
    list.push({ original_date: r.original_date, rescheduled_date: r.rescheduled_date });
    map.set(r.signup_id, list);
  }
  return map;
}

/**
 * Who was (or is) on the route for each of `dates`, past or present. The schedule is computed
 * from slots rather than stored, so a past day has to be reconstructed from today's customer
 * data - bounded so a customer can't appear on days before they existed (created_at, NOT the
 * payment date: booked customers get serviced before they pay), after they cancelled, or from
 * the day they were paused. Anything with a real record on that date (a completion or a
 * skip/move away) is always included, whatever those bounds say, so history is never hidden.
 * A yard moved away from a date stays on that date as 'not_done' (that's the audit trail),
 * and shows as a normal pending yard on the date it was moved to.
 */
export async function getRoutesForDates(dates: string[]): Promise<Map<string, DayYard[]>> {
  const result = new Map<string, DayYard[]>(dates.map((d) => [d, []]));
  if (dates.length === 0) return result;

  const pool = getPool();
  const todayKey = toDateKey(nowInJohannesburg());
  const [{ rows: signups }, { rows: skips }, { rows: visits }, ctx, drivenSkips] = await Promise.all([
    pool.query<RoutePoolRow>(
      `select id, full_name, house_number, whatsapp_number, block, plan, notes, payment_status,
              service_slot, scheduled_visit_date::text,
              next_service_date::text, routing_from::text,
              (created_at at time zone 'Africa/Johannesburg')::date::text as created_date,
              (paused_at at time zone 'Africa/Johannesburg')::date::text as paused_date,
              (cancelled_at at time zone 'Africa/Johannesburg')::date::text as cancelled_date
       from signups
       where payment_status in ('active', 'booked', 'cancelled', 'archived')`
    ),
    pool.query<{ signup_id: string; original_date: string; reason: SkipOrMoveReason; rescheduled_date: string }>(
      `select signup_id, original_date::text, reason, rescheduled_date::text
       from skipped_visits
       where original_date = any($1::date[]) or rescheduled_date = any($1::date[])`,
      [dates]
    ),
    pool.query<{ signup_id: string; service_date: string; completed_at: string }>(
      "select signup_id, service_date::text, completed_at from service_visits where service_date = any($1::date[])",
      [dates]
    ),
    getRoutingContext(),
    getDrivenSkips(),
  ]);

  const dueCache = new Map<string, string>();
  const dueOf = (s: RoutePoolRow): string => {
    let due = dueCache.get(s.id);
    if (due === undefined) {
      due = effectiveDueDate(s.next_service_date!, drivenSkips.get(s.id) ?? [], ctx.workingDays, ctx.blocked);
      dueCache.set(s.id, due);
    }
    return due;
  };

  const skipByKey = new Map(skips.map((k) => [`${k.signup_id}|${k.original_date}`, k]));
  const movedOnto = new Set(skips.map((k) => `${k.signup_id}|${k.rescheduled_date}`));
  const visitByKey = new Map(visits.map((v) => [`${v.signup_id}|${v.service_date}`, v]));

  for (const date of dates) {
    const slot = candidateSlotForDate(new Date(`${date}T00:00:00`));
    const workable = isWorkingDay(new Date(`${date}T00:00:00`), ctx.workingDays) && !ctx.blocked.has(date);
    const yards = result.get(date)!;
    for (const s of signups) {
      const key = `${s.id}|${date}`;
      const visit = visitByKey.get(key);
      const skip = skipByKey.get(key);
      const driven = isDateDriven(s, date);
      let overdueSince: string | null = null;
      if (!visit && !skip) {
        // Archived = off the schedule: no pending yards, past or future.
        if (s.payment_status === "archived") continue;
        const eligible =
          s.created_date <= date &&
          (s.paused_date === null || s.paused_date > date) &&
          (s.payment_status !== "cancelled" || (s.cancelled_date !== null && s.cancelled_date > date));
        let due: boolean;
        if (driven) {
          // Routed by the next service date: due on it, or overdue if it has passed (never on a day off).
          const dueDate = dueOf(s);
          const status = dueStatusOn(date, todayKey, dueDate);
          due = status !== "none" && (workable || dueDate === date);
          if (due && status === "overdue") overdueSince = dueDate;
        } else {
          due = (slot !== null && s.service_slot === slot) || s.scheduled_visit_date === date || movedOnto.has(key);
        }
        if (!eligible || !due) continue;
      }
      yards.push({
        id: s.id,
        fullName: s.full_name,
        houseNumber: s.house_number,
        whatsappNumber: s.whatsapp_number,
        block: s.block,
        plan: s.plan,
        notes: s.notes,
        status: visit ? "done" : skip ? "not_done" : "pending",
        completedAt: visit?.completed_at ?? null,
        reason: !visit && skip ? skip.reason : null,
        rescheduledDate: !visit && skip ? skip.rescheduled_date : null,
        overdueSince,
        driven,
      });
    }
  }
  return result;
}

/**
 * One day's route as a single list in service order: overdue yards first (marked), then the rest - each part
 * by block, then house number, so the crew walks the estate in order rather than zigzagging by date.
 */
export async function getDayRoute(dateKey: string): Promise<{ yards: DayYard[] }> {
  const routes = await getRoutesForDates([dateKey]);
  const all = routes.get(dateKey) ?? [];
  const inOrder = (list: DayYard[]) => groupByBlock(list).flatMap((g) => g.customers);
  const yards = [...inOrder(all.filter((y) => y.overdueSince !== null)), ...inOrder(all.filter((y) => y.overdueSince === null))];
  return { yards };
}

/**
 * THE one way work is marked done: a visit record against a client, with a date and a worker. Recording
 * also sets the client's next service date (14 days on in September-April, 30 in May-August, from this
 * date) - but only when it is their latest visit and they are a recurring, active or booked client, so a
 * visit captured days late can never pull a date backwards.
 *
 * overwrite = true (Record a visit): the same client and date again corrects the worker and note.
 * overwrite = false (Confirm day): a client who already has a record for that date is left exactly as is.
 */
async function writeVisitRecord(input: {
  signupId: string;
  serviceDate: string;
  worker: string;
  note: string | null;
  overwrite: boolean;
}): Promise<{ inserted: boolean; nextDateUpdated: boolean }> {
  const pool = getPool();
  const { rows } = await pool.query<{ inserted: boolean }>(
    `insert into service_visits (signup_id, service_date, crew, note)
     values ($1, $2::date, $3, $4)
     on conflict (signup_id, service_date) ${
       input.overwrite ? "do update set crew = excluded.crew, note = excluded.note" : "do nothing"
     }
     returning (xmax = 0) as inserted`,
    [input.signupId, input.serviceDate, input.worker, input.note]
  );
  // do nothing + conflict returns no row: the record was already there, so nothing is touched.
  if (rows.length === 0) return { inserted: false, nextDateUpdated: false };
  const advanced = await advanceNextServiceDates([input.signupId], input.serviceDate);
  return { inserted: rows[0].inserted, nextDateUpdated: advanced > 0 };
}

/**
 * "Confirm day": a bulk shortcut over the visit record - it writes one record, dated `dateKey` and credited
 * to `worker`, for each client on that day's list who has no record for that date yet. `onlyIds` is the
 * exact set the owner ticked on the review screen: nobody outside it is ever written, and nobody who isn't
 * still on the list is either. It keeps no state of its own: nothing is stored about the day, so there is no
 * such thing as an unconfirmed or confirmed day. Returns records written.
 */
export async function confirmDay(dateKey: string, worker: string, onlyIds: string[]): Promise<number> {
  const { yards } = await getDayRoute(dateKey);
  const allowed = new Set(onlyIds);
  let written = 0;
  for (const y of yards) {
    if (y.status !== "pending" || !allowed.has(y.id)) continue;
    const res = await writeVisitRecord({ signupId: y.id, serviceDate: dateKey, worker, note: null, overwrite: false });
    if (res.inserted) written++;
  }
  return written;
}

/**
 * Sets the next service date (and starts date-based routing) for clients just recorded as done on `dateKey`.
 * Skipped for once-off bookings, anyone not active/booked, and any client with a later visit already on
 * record. Returns how many clients were updated.
 */
async function advanceNextServiceDates(signupIds: string[], dateKey: string): Promise<number> {
  const { rowCount } = await getPool().query(
    `update signups set next_service_date = $2::date, next_service_date_manual = false,
            routing_from = coalesce(routing_from, $3::date), updated_at = now()
     where id = any($1::uuid[]) and plan <> 'once-off' and payment_status in ('active', 'booked')
       and not exists (select 1 from service_visits v where v.signup_id = signups.id and v.service_date > $3::date)`,
    [signupIds, suggestNextServiceDate(dateKey), dateKey]
  );
  return rowCount ?? 0;
}

/**
 * Undoing a completion (flagging Not done / moving that day) must put the client back on the list: their next
 * date was already advanced by the completion, so it is pulled back to the day they were actually due. The
 * move or flag row then decides when they are really due. Never done if a later visit is on record.
 */
async function restoreDueAfterUndo(signupId: string, dateKey: string): Promise<void> {
  await getPool().query(
    `update signups set next_service_date = $2::date, next_service_date_manual = false, updated_at = now()
     where id = $1 and plan <> 'once-off' and routing_from is not null and next_service_date > $2::date
       and not exists (select 1 from service_visits v where v.signup_id = $1 and v.service_date > $2::date)`,
    [signupId, dateKey]
  );
}

/** Undo a "not done" flag: removes the skip, so the yard is back on that day's list. */
export async function unflagNotDone(signupId: string, dateKey: string): Promise<void> {
  await getPool().query("delete from skipped_visits where signup_id = $1 and original_date = $2::date", [
    signupId,
    dateKey,
  ]);
}

export interface SkippedVisitRow {
  id: string;
  signup_id: string;
  original_date: string;
  reason: SkipOrMoveReason;
  rescheduled_date: string;
  created_at: string;
}

/**
 * Shared by recordSkippedVisit ("Can't do", auto-rescheduled to the next working day) and
 * recordMovedVisit ("Move", operator-chosen date) - both are "this visit didn't happen on
 * its normal date, it happens on rescheduled_date instead, for this reason" rows in the
 * same table. Idempotent per signup/day: acting again for the same original_date (e.g. to
 * correct a reason or pick a different target date) updates the existing row.
 */
async function insertOrUpdateSkip(
  signupId: string,
  originalDate: string,
  reason: SkipOrMoveReason,
  rescheduledDate: string
): Promise<SkippedVisitRow> {
  const { rows } = await getPool().query<SkippedVisitRow>(
    `insert into skipped_visits (signup_id, original_date, reason, rescheduled_date)
     values ($1, $2::date, $3, $4::date)
     on conflict (signup_id, original_date) do update set reason = excluded.reason, rescheduled_date = excluded.rescheduled_date
     returning id, signup_id, original_date::text, reason, rescheduled_date::text, created_at`,
    [signupId, originalDate, reason, rescheduledDate]
  );
  return rows[0];
}

/**
 * Flags a yard "not done" on `serviceDate` (default today) and bumps it to the next working day
 * after today - for a past day that's still forward-looking, since the work now needs doing.
 * A yard can't be both done and not done on one day, so flagging replaces any completion record
 * (which is what makes correcting a confirmed day work).
 */
export async function recordSkippedVisit(
  signupId: string,
  reason: SkipReason,
  serviceDate?: string
): Promise<SkippedVisitRow> {
  const { workingDays } = await getAppSettings();
  const today = nowInJohannesburg();
  const originalDate = serviceDate ?? toDateKey(today);
  const from = originalDate > toDateKey(today) ? new Date(`${originalDate}T00:00:00`) : today;
  const rescheduledDate = toDateKey(nextWorkingDay(from, workingDays));
  await getPool().query("delete from service_visits where signup_id = $1 and service_date = $2::date", [
    signupId,
    originalDate,
  ]);
  await restoreDueAfterUndo(signupId, originalDate);
  return insertOrUpdateSkip(signupId, originalDate, reason, rescheduledDate);
}

/**
 * "Move one visit to a specific date" - a deliberate reschedule (not an excuse), so it's
 * recorded with MOVED_REASON rather than one of the "Can't do" reasons. `originalDate` is
 * whichever due date the operator is moving (today's or tomorrow's), passed in by the
 * caller rather than assumed to be today, since this action is available from both tabs.
 */
export async function recordMovedVisit(
  signupId: string,
  originalDate: string,
  targetDate: string
): Promise<SkippedVisitRow> {
  // Same rule as flagging not-done: a yard can't be both done and moved on the same day.
  await getPool().query("delete from service_visits where signup_id = $1 and service_date = $2::date", [
    signupId,
    originalDate,
  ]);
  await restoreDueAfterUndo(signupId, originalDate);
  return insertOrUpdateSkip(signupId, originalDate, MOVED_REASON, targetDate);
}

/**
 * Bulk-skips every customer due on `dateKey` (not already done, not already individually
 * skipped/moved) to `rescheduledKey`, with the given reason. A single INSERT...SELECT
 * rather than one query per customer; ON CONFLICT DO NOTHING leaves an already-actioned
 * row alone rather than overwriting a more specific reason. Shared by postponeAllToday
 * ("Postpone today", reason 'rain') and blockDate (reason 'blocked').
 */
async function bulkMoveVisitsForDate(
  dateKey: string,
  reason: SkipOrMoveReason,
  rescheduledKey: string
): Promise<number> {
  const slot = candidateSlotForDate(new Date(`${dateKey}T00:00:00`));
  const { rows } = await getPool().query<{ signup_id: string }>(
    `insert into skipped_visits (signup_id, original_date, reason, rescheduled_date)
     select s.id, $1::date, $3, $2::date
     from signups s
     where s.payment_status in ('active', 'booked')
       and s.paused_at is null
       and (($4::int is not null and s.service_slot = $4) or s.scheduled_visit_date = $1::date)
       and not (s.plan <> 'once-off' and s.next_service_date is not null and s.routing_from is not null and s.routing_from <= $1::date)
       and not exists (select 1 from service_visits v where v.signup_id = s.id and v.service_date = $1::date)
       and not exists (select 1 from skipped_visits sv where sv.signup_id = s.id and sv.original_date = $1::date)
     on conflict (signup_id, original_date) do nothing
     returning signup_id`,
    [dateKey, rescheduledKey, reason, slot]
  );

  // Clients routed by their next service date: everyone still pending on that day's list, overdue ones included.
  const { yards } = await getDayRoute(dateKey);
  const drivenIds = yards.filter((y) => y.driven && y.status === "pending").map((y) => y.id);
  let drivenMoved = 0;
  if (drivenIds.length > 0) {
    const moved = await getPool().query(
      `insert into skipped_visits (signup_id, original_date, reason, rescheduled_date)
       select unnest($1::uuid[]), $2::date, $3, $4::date
       on conflict (signup_id, original_date) do nothing`,
      [drivenIds, dateKey, reason, rescheduledKey]
    );
    drivenMoved = moved.rowCount ?? 0;
  }
  return rows.length + drivenMoved;
}

/** "Postpone today" - moves everyone still due today to the next working day, for rain. */
export async function postponeAllToday(): Promise<number> {
  const { workingDays } = await getAppSettings();
  const today = nowInJohannesburg();
  const todayKey = toDateKey(today);
  const rescheduledKey = toDateKey(nextWorkingDay(today, workingDays));
  return bulkMoveVisitsForDate(todayKey, "rain", rescheduledKey);
}

/**
 * "Block a date" - marks it unavailable and moves everyone currently due on it to the
 * next working day that isn't itself already blocked (rolling forward past adjacent
 * holidays). A customer added later whose recurring slot lands on an already-blocked date
 * isn't caught retroactively by this one-time action - the calendar flags blocked dates
 * visually so the owner can re-block or move them individually if that happens.
 */
export async function blockDate(dateKey: string, label: string | null): Promise<number> {
  await getPool().query(
    `insert into blocked_dates (date, label) values ($1::date, $2)
     on conflict (date) do update set label = excluded.label`,
    [dateKey, label]
  );

  const { workingDays } = await getAppSettings();
  const blocked = await getBlockedDateSet();
  let candidate = nextWorkingDay(new Date(`${dateKey}T00:00:00`), workingDays);
  while (blocked.has(toDateKey(candidate))) {
    candidate = nextWorkingDay(candidate, workingDays);
  }
  return bulkMoveVisitsForDate(dateKey, BLOCKED_REASON, toDateKey(candidate));
}

export async function unblockDate(dateKey: string): Promise<void> {
  await getPool().query("delete from blocked_dates where date = $1::date", [dateKey]);
}

export interface BlockedDate {
  date: string;
  label: string | null;
}

export async function getBlockedDates(): Promise<BlockedDate[]> {
  const { rows } = await getPool().query<{ date: string; label: string | null }>(
    "select date::text, label from blocked_dates order by date asc"
  );
  return rows;
}

async function getBlockedDateSet(): Promise<Set<string>> {
  const dates = await getBlockedDates();
  return new Set(dates.map((d) => d.date));
}

export interface AppSettings {
  dailyVisitLimit: number;
  workingDays: number[];
}

/** Singleton row, seeded by the schema migration - always exists. */
export async function getAppSettings(): Promise<AppSettings> {
  const { rows } = await getPool().query<{ daily_visit_limit: number; working_days: number[] }>(
    "select daily_visit_limit, working_days from app_settings where id = true"
  );
  return { dailyVisitLimit: rows[0].daily_visit_limit, workingDays: rows[0].working_days };
}

export async function updateAppSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const dailyVisitLimit = input.dailyVisitLimit ?? current.dailyVisitLimit;
  const workingDays = input.workingDays ?? current.workingDays;
  await getPool().query(
    "update app_settings set daily_visit_limit = $1, working_days = $2 where id = true",
    [dailyVisitLimit, workingDays]
  );
  return { dailyVisitLimit, workingDays };
}

/** For the ops Today list, to show an already-skipped row as skipped rather than actionable. */
export async function getSkipsForDate(date: string): Promise<Map<string, { reason: SkipOrMoveReason; rescheduledDate: string }>> {
  const { rows } = await getPool().query<{ signup_id: string; reason: SkipOrMoveReason; rescheduled_date: string }>(
    "select signup_id, reason, rescheduled_date::text from skipped_visits where original_date = $1",
    [date]
  );
  return new Map(rows.map((r) => [r.signup_id, { reason: r.reason, rescheduledDate: r.rescheduled_date }]));
}

export interface SkippedVisitWithCustomer {
  id: string;
  signupId: string;
  fullName: string;
  houseNumber: string;
  reason: SkipOrMoveReason;
  originalDate: string;
  rescheduledDate: string;
}

/** For the owner dashboard's "Missed visits" panel. */
export async function getSkippedVisitsThisMonth(): Promise<SkippedVisitWithCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    signup_id: string;
    full_name: string;
    house_number: string;
    reason: SkipOrMoveReason;
    original_date: string;
    rescheduled_date: string;
  }>(
    `select sv.id, sv.signup_id, s.full_name, s.house_number, sv.reason, sv.original_date::text, sv.rescheduled_date::text
     from skipped_visits sv
     join signups s on s.id = sv.signup_id
     where sv.created_at >= ${SAST_MONTH_START_SQL}
       and sv.created_at < ${SAST_MONTH_START_SQL} + interval '1 month'
     order by sv.created_at desc`
  );
  return rows.map((r) => ({
    id: r.id,
    signupId: r.signup_id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    reason: r.reason,
    originalDate: r.original_date,
    rescheduledDate: r.rescheduled_date,
  }));
}

/** Active subscribers only - once-off bookings don't have an ongoing subscription state. */
export async function getActiveCustomerCounts(): Promise<{ monthly: number; annual: number }> {
  const { rows } = await getPool().query<{ plan: "monthly" | "annual"; count: string }>(
    "select plan, count(*) from signups where payment_status = 'active' and plan in ('monthly', 'annual') group by plan"
  );
  const counts = { monthly: 0, annual: 0 };
  for (const row of rows) counts[row.plan] = Number(row.count);
  return counts;
}

export async function getOnceOffJobsThisMonth(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `select count(distinct s.id) as count
     from signups s
     join payments p on p.signup_id = s.id
     where s.plan = 'once-off'
       and p.received_at >= ${SAST_MONTH_START_SQL}
       and p.received_at < ${SAST_MONTH_START_SQL} + interval '1 month'`
  );
  return Number(rows[0].count);
}

export async function getRevenueThisMonth(): Promise<{
  subscriber: number;
  onceOff: number;
  total: number;
  byMethod: { payfast: number; eft: number; cash: number };
}> {
  const { rows } = await getPool().query<{
    subscriber: string;
    once_off: string;
    payfast: string;
    eft: string;
    cash: string;
  }>(
    `select
       coalesce(sum(p.amount) filter (where s.plan in ('monthly', 'annual')), 0) as subscriber,
       coalesce(sum(p.amount) filter (where s.plan = 'once-off'), 0) as once_off,
       coalesce(sum(p.amount) filter (where p.method = 'payfast'), 0) as payfast,
       coalesce(sum(p.amount) filter (where p.method = 'eft'), 0) as eft,
       coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) as cash
     from payments p
     join signups s on s.id = p.signup_id
     where p.received_at >= ${SAST_MONTH_START_SQL}
       and p.received_at < ${SAST_MONTH_START_SQL} + interval '1 month'`
  );
  const subscriber = Number(rows[0].subscriber);
  const onceOff = Number(rows[0].once_off);
  return {
    subscriber,
    onceOff,
    total: subscriber + onceOff,
    byMethod: { payfast: Number(rows[0].payfast), eft: Number(rows[0].eft), cash: Number(rows[0].cash) },
  };
}

export async function getCancellationsThisMonth(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `select count(*) from signups
     where payment_status = 'cancelled'
       and cancelled_at >= ${SAST_MONTH_START_SQL}
       and cancelled_at < ${SAST_MONTH_START_SQL} + interval '1 month'`
  );
  return Number(rows[0].count);
}

export interface FailedOrOverdueCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  daysLate: number;
  status: "failed" | "overdue" | "unpaid";
}

/**
 * Four sources, merged: signups whose *first* payment never went through (still
 * 'pending' -> 'failed'); active signups with a *recurring* PayFast charge that failed
 * (last_payment_failed_at set by the ITN handler - still 'active', still on the
 * schedule, just needs chasing); active EFT/cash customers who have never once had a
 * payment recorded ('unpaid' - see below); and active signups (of any method) whose last
 * *recorded* payment is older than one billing period (no grace period). Groups don't
 * overlap by construction (WHERE clauses below) so nobody is double-listed.
 *
 * The 'unpaid' case matters because 'active' does not mean paid for a non-PayFast
 * customer - createManualSignup marks EFT/cash customers active immediately, on the
 * owner's word, with zero payment confirmation. Unlike PayFast (whose start_date is only
 * ever set by a real completed charge - see activateSignup), an EFT/cash customer's
 * start_date is set at creation regardless of whether any money has actually changed
 * hands. Falling back to it as a "last payment" baseline would silently give them a full
 * billing period of presumed-paid with nothing to back it up - so for that specific case
 * (non-PayFast, zero rows ever in `payments`) there is no grace period at all: they show
 * up as unpaid from day one, same as anyone else with literally no payment on record.
 */
export async function getFailedOrOverdueCustomers(): Promise<FailedOrOverdueCustomer[]> {
  const pool = getPool();
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const { rows: failedRows } = await pool.query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    reference_date: string;
  }>(
    `select id, full_name, house_number, whatsapp_number, created_at as reference_date
     from signups where payment_status = 'failed'
     union all
     select id, full_name, house_number, whatsapp_number, last_payment_failed_at as reference_date
     from signups where payment_status = 'active' and last_payment_failed_at is not null`
  );

  const failed: FailedOrOverdueCustomer[] = failedRows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    daysLate: Math.max(0, Math.floor((now - new Date(r.reference_date).getTime()) / msPerDay)),
    status: "failed",
  }));

  const { rows: activeRows } = await pool.query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    payment_method: SignupRow["payment_method"];
    last_payment_at: string | null;
    fallback_baseline: string;
  }>(
    `select s.id, s.full_name, s.house_number, s.whatsapp_number, s.plan, s.payment_method,
            max(p.received_at) as last_payment_at,
            coalesce(s.start_date::timestamptz, s.created_at) as fallback_baseline
     from signups s
     left join payments p on p.signup_id = s.id
     where s.payment_status = 'active' and s.last_payment_failed_at is null
       and s.paused_at is null
     group by s.id`
  );

  const overdue: FailedOrOverdueCustomer[] = [];
  for (const r of activeRows) {
    if (r.last_payment_at === null && r.payment_method !== "payfast") {
      overdue.push({
        id: r.id,
        fullName: r.full_name,
        houseNumber: r.house_number,
        whatsappNumber: r.whatsapp_number,
        daysLate: Math.max(0, Math.floor((now - new Date(r.fallback_baseline).getTime()) / msPerDay)),
        status: "unpaid",
      });
      continue;
    }
    // Once-off has no renewal cycle - nothing to be "overdue" on once it's paid (or is
    // PayFast, which always records a payment via the ITN on completion).
    if (r.plan === "once-off") continue;

    const nextDue = new Date(r.last_payment_at ?? r.fallback_baseline);
    if (r.plan === "annual") nextDue.setFullYear(nextDue.getFullYear() + 1);
    else nextDue.setMonth(nextDue.getMonth() + 1);

    if (now > nextDue.getTime()) {
      overdue.push({
        id: r.id,
        fullName: r.full_name,
        houseNumber: r.house_number,
        whatsappNumber: r.whatsapp_number,
        daysLate: Math.floor((now - nextDue.getTime()) / msPerDay),
        status: "overdue",
      });
    }
  }

  return [...failed, ...overdue];
}

/** Visits due-so-far this month (not the whole month) vs. actually completed. */
export async function getCompletionRateThisMonth(): Promise<{ done: number; scheduled: number }> {
  const today = nowInJohannesburg();
  const todayDay = today.getDate();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // service_slot is null for once-off bookings - they've got no recurring schedule to
  // measure a completion rate against, so this stays scoped to subscribers.
  const { rows: slotRows } = await getPool().query<{ service_slot: number }>(
    "select service_slot from signups where payment_status in ('active', 'booked') and paused_at is null and service_slot is not null"
  );

  let scheduled = 0;
  for (const { service_slot } of slotRows) {
    for (const day of visitDaysForSlotInMonth(service_slot, today)) {
      if (day <= todayDay) scheduled += 1;
    }
  }

  const { rows: doneRows } = await getPool().query<{ count: string }>(
    "select count(*) from service_visits where service_date >= $1",
    [toDateKey(monthStart)]
  );

  return { done: Number(doneRows[0].count), scheduled };
}

export interface UnwelcomedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  trackingToken: string;
}

/**
 * Active AND booked (book now, pay later) signups nobody's sent the WhatsApp welcome message to
 * yet - a customer who chose to pay later has a real service day reserved and deserves the same
 * welcome as one who paid. Archived/cancelled/abandoned signups are never welcomed. Returns the raw
 * schedule fields (service_slot for subscribers, scheduled_visit_date for once-off)
 * rather than a formatted day - the caller works out "next occurrence" via
 * lib/schedule.ts, since that's a pure function of "today" and doesn't belong in a query.
 */
export async function getUnwelcomedCustomers(): Promise<UnwelcomedCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    service_slot: number | null;
    scheduled_visit_date: string | null;
    tracking_token: string;
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, service_slot, scheduled_visit_date::text, tracking_token
     from signups
     where payment_status in ('active', 'booked') and welcomed_at is null
       and not (${TO_BE_SCHEDULED_WHERE})
     order by created_at asc`
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    plan: r.plan,
    serviceSlot: r.service_slot,
    scheduledVisitDate: r.scheduled_visit_date,
    trackingToken: r.tracking_token,
  }));
}

export async function markWelcomed(id: string): Promise<void> {
  await getPool().query(
    "update signups set welcomed_at = now() where id = $1 and payment_status in ('active', 'booked')",
    [id]
  );
}

/**
 * "To be scheduled": a monthly or annual customer who is paying or has booked (active or booked) and has been
 * given no service day - no fixed slot and no next service date - so they are on no route and on no calendar until
 * the owner assigns one. Derived from the data, so there is nothing to keep in step.
 */
const TO_BE_SCHEDULED_WHERE = `payment_status in ('active', 'booked') and plan in ('monthly', 'annual')
  and service_slot is null and next_service_date is null`;

export interface ToBeScheduledCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  paymentStatus: "booked" | "active";
  paymentTiming: "pay_now" | "pay_after_service";
  welcomed: boolean;
  trackingToken: string;
  /** Whole days since they booked - the "waiting on me" clock. */
  waitingDays: number;
}

/** Booked customers waiting on the owner for a service date, longest-waiting first. */
export async function getToBeScheduled(): Promise<ToBeScheduledCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    block: number | null;
    payment_status: "booked" | "active";
    payment_timing: "pay_now" | "pay_after_service";
    welcomed: boolean;
    tracking_token: string;
    waiting_days: number;
  }>(
    `select id, full_name, house_number, whatsapp_number, block, payment_status, payment_timing,
            welcomed_at is not null as welcomed, tracking_token,
            floor(extract(epoch from (now() - created_at)) / 86400)::int as waiting_days
     from signups
     where ${TO_BE_SCHEDULED_WHERE}
     order by created_at asc`
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    block: r.block,
    paymentStatus: r.payment_status,
    paymentTiming: r.payment_timing,
    welcomed: r.welcomed,
    trackingToken: r.tracking_token,
    waitingDays: r.waiting_days,
  }));
}

export interface PaymentLinkDue {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  /** The most recent recorded visit - the service the payment link follows. */
  lastVisitDate: string;
  paymentLinkSentAt: string | null;
  paymentLinkExpired: boolean;
}

/**
 * Customers who chose to pay after their first service, have had a visit recorded, and have not activated yet:
 * the owner dashboard's "Send payment link" list. The flag is the data itself - it clears the moment the
 * payment goes through (the customer stops being 'booked'), with nothing for anyone to tick off.
 */
export async function getPaymentLinksDue(): Promise<PaymentLinkDue[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    last_visit_date: string;
    payment_link_sent_at: string | null;
    expired: boolean;
  }>(
    `select s.id, s.full_name, s.house_number, s.whatsapp_number, s.plan, s.payment_link_sent_at,
            (select max(v.service_date)::text from service_visits v where v.signup_id = s.id) as last_visit_date,
            (s.payment_link_expires_at is not null and s.payment_link_expires_at < now()) as expired
     from signups s
     where s.payment_status = 'booked' and s.payment_timing = 'pay_after_service' and s.plan <> 'once-off'
       and s.payment_method = 'payfast'
       and exists (select 1 from service_visits v where v.signup_id = s.id)
     order by last_visit_date asc, s.created_at asc`
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    plan: r.plan,
    lastVisitDate: r.last_visit_date,
    paymentLinkSentAt: r.payment_link_sent_at,
    paymentLinkExpired: r.expired,
  }));
}

export interface BookedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  block: number | null;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  paymentLinkSentAt: string | null;
  paymentLinkExpiresAt: string | null;
  notes: string | null;
  /** Whole days since the booking was made - the "awaiting payment" clock. */
  awaitingDays: number;
}

/**
 * Stage 1 signups waiting on Stage 2 - shown on the ops "Booked" tab (with a "Send
 * payment link" action) and, read-only, on the owner dashboard's awaiting-payment list.
 * Same raw-schedule-fields approach as getUnwelcomedCustomers - the caller works out the
 * service day label via lib/schedule.ts. Returns both service_slot (monthly/annual) and
 * scheduled_visit_date (once-off) since a booking can now be any of the three plans.
 */
export async function getBookedCustomers(): Promise<BookedCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    block: number | null;
    service_slot: number | null;
    scheduled_visit_date: string | null;
    payment_link_sent_at: string | null;
    payment_link_expires_at: string | null;
    notes: string | null;
    awaiting_days: number;
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, block, service_slot,
            scheduled_visit_date::text, payment_link_sent_at, payment_link_expires_at::text, notes,
            floor(extract(epoch from (now() - created_at)) / 86400)::int as awaiting_days
     from signups
     where payment_status = 'booked'
     order by created_at asc`
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    plan: r.plan,
    block: r.block,
    serviceSlot: r.service_slot,
    scheduledVisitDate: r.scheduled_visit_date,
    paymentLinkSentAt: r.payment_link_sent_at,
    paymentLinkExpiresAt: r.payment_link_expires_at,
    notes: r.notes,
    awaitingDays: r.awaiting_days,
  }));
}

export interface CustomerRow {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  paymentStatus: SignupRow["payment_status"];
  paymentMethod: SignupRow["payment_method"];
  block: number | null;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  notes: string | null;
  pausedAt: string | null;
  /** Days since booking, for a booked (awaiting payment) customer only - null for everyone else. */
  awaitingPaymentDays: number | null;
  /** On the failed/overdue list (getFailedOrOverdueCustomers) - the same definition the dashboard uses. */
  overdue: boolean;
}

/** Full roster for the owner "Customers" tab - search/filter happens client-side since
 * the customer count is small; this always returns everyone regardless of status. */
export async function getAllCustomers(): Promise<CustomerRow[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    payment_status: SignupRow["payment_status"];
    payment_method: SignupRow["payment_method"];
    block: number | null;
    service_slot: number | null;
    scheduled_visit_date: string | null;
    notes: string | null;
    paused_at: string | null;
    awaiting_days: number | null;
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, payment_status, payment_method,
            block, service_slot, scheduled_visit_date::text, notes, paused_at,
            case when payment_status = 'booked' then floor(extract(epoch from (now() - created_at)) / 86400)::int end as awaiting_days
     from signups
     order by created_at desc`
  );
  const overdueIds = new Set((await getFailedOrOverdueCustomers()).map((c) => c.id));
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    plan: r.plan,
    paymentStatus: r.payment_status,
    paymentMethod: r.payment_method,
    block: r.block,
    serviceSlot: r.service_slot,
    scheduledVisitDate: r.scheduled_visit_date,
    notes: r.notes,
    pausedAt: r.paused_at,
    awaitingPaymentDays: r.awaiting_days,
    overdue: overdueIds.has(r.id),
  }));
}

export interface ManualSignupInput {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  paymentMethod: "payfast" | "eft" | "cash";
  /** Stated by the owner every time, never inferred: already paid, or still awaiting payment. */
  paymentState: "paid" | "awaiting";
  block: number | null;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  notes: string | null;
}

/**
 * "Add customer manually" on the owner page. The owner says whether the customer has already paid:
 * 'paid' lands as active with today as the start date, 'awaiting' lands as booked (awaiting payment) and is
 * flagged "Send payment link" once a visit is recorded - but only for card customers, since a payment link is a
 * card checkout. A subscriber is only given a service day if the owner types a slot; left blank they are "to be
 * scheduled", the same as a web signup, so nobody is promised a date the owner has not chosen.
 */
export async function createManualSignup(input: ManualSignupInput): Promise<SignupRow> {
  const id = randomUUID();
  const now = nowInJohannesburg();
  const subscriber = isSubscriberPlan(input.plan);
  const { workingDays } = await getAppSettings();

  const serviceSlot = subscriber ? input.serviceSlot : null;
  const scheduledVisitDate = !subscriber
    ? input.scheduledVisitDate ?? toDateKey(addWorkingDays(now, MIN_NOTICE_WORKING_DAYS, workingDays))
    : null;

  const paymentStatus = input.paymentState === "paid" ? "active" : "booked";
  const startDate = paymentStatus === "active" ? toDateKey(now) : null;

  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (
       id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id,
       service_slot, terms_accepted_at, block, payment_status, scheduled_visit_date,
       payment_method, notes, start_date, payment_timing
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13, $14, $15)
     returning *`,
    [
      id,
      input.fullName,
      input.houseNumber,
      input.whatsappNumber,
      input.plan,
      PLANS[input.plan].amount,
      id,
      serviceSlot,
      input.block,
      paymentStatus,
      scheduledVisitDate,
      input.paymentMethod,
      input.notes,
      startDate,
      input.paymentState === "awaiting" ? "pay_after_service" : "pay_now",
    ]
  );
  return rows[0];
}

export interface UpdateSignupInput {
  signupId: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  paymentMethod: "payfast" | "eft" | "cash";
  block: number | null;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  notes: string | null;
}

/** Owner-page "Edit customer" - always overwrites the full editable field set (see
 * lib/validation.ts's updateSignupSchema for why this isn't a partial update). Amount is
 * recomputed from the plan server-side, never trusted from the client. */
export async function updateSignup(input: UpdateSignupInput): Promise<SignupRow | null> {
  const { rows } = await getPool().query<SignupRow>(
    `update signups set
       full_name = $2, house_number = $3, whatsapp_number = $4, plan = $5, amount = $6,
       payment_method = $7, block = $8, service_slot = $9, scheduled_visit_date = $10,
       notes = $11, updated_at = now()
     where id = $1
     returning *`,
    [
      input.signupId,
      input.fullName,
      input.houseNumber,
      input.whatsappNumber,
      input.plan,
      PLANS[input.plan].amount,
      input.paymentMethod,
      input.block,
      input.serviceSlot,
      input.scheduledVisitDate,
      input.notes,
    ]
  );
  return rows[0] ?? null;
}

/**
 * "Change a customer's service day... apply to all future visits" - a lighter-weight
 * counterpart to updateSignup that touches only the schedule field, for the owner
 * Customers tab and the calendar's per-customer day-change action. Only the field that's
 * actually applicable to the customer's current plan is ever passed by callers, so a bare
 * coalesce (update only what's provided) is safe - there's no case here where the other
 * field needs to be explicitly cleared.
 */
export async function setServiceDay(
  signupId: string,
  serviceSlot: number | null | undefined,
  scheduledVisitDate: string | null | undefined
): Promise<void> {
  await getPool().query(
    `update signups set
       service_slot = coalesce($2, service_slot),
       scheduled_visit_date = coalesce($3::date, scheduled_visit_date),
       updated_at = now()
     where id = $1`,
    [signupId, serviceSlot ?? null, scheduledVisitDate ?? null]
  );
  if (serviceSlot != null) await retargetNextDateToSlot(signupId, serviceSlot);
}

/** Only affects an 'active' row - pausing a booked/pending/cancelled customer has nothing to pause. */
export async function pauseSignup(id: string): Promise<void> {
  await getPool().query(
    "update signups set paused_at = now(), updated_at = now() where id = $1 and payment_status = 'active'",
    [id]
  );
}

export async function resumeSignup(id: string): Promise<void> {
  await getPool().query(
    "update signups set paused_at = null, updated_at = now() where id = $1",
    [id]
  );
  // A date that passed while they were paused must not come back as "overdue" - they are due from today.
  await getPool().query(
    `update signups set next_service_date = $2::date, next_service_date_manual = false
     where id = $1 and plan <> 'once-off' and routing_from is not null and next_service_date < $2::date`,
    [id, toDateKey(nowInJohannesburg())]
  );
}

/**
 * Routing is by next service date, so changing a client's fixed day must move that
 * date too - otherwise the change would silently do nothing. The new date is the slot's next visit from today.
 */
async function retargetNextDateToSlot(signupId: string, slot: number): Promise<void> {
  const today = nowInJohannesburg();
  await getPool().query(
    `update signups set next_service_date = $2::date, next_service_date_manual = false,
            routing_from = coalesce(routing_from, $3::date), updated_at = now()
     where id = $1 and plan <> 'once-off' and payment_status in ('active', 'booked')`,
    [signupId, toDateKey(nextOccurrenceForSlot(slot, today)), toDateKey(today)]
  );
}

/**
 * Owner-initiated cancellation, from any non-cancelled state (active, booked, paused,
 * pending, failed) - unlike cancelSignup (used only by the ITN handler, which deliberately
 * stays scoped to 'active' rows so it never touches a booking mid-payment-link).
 */
export async function ownerCancelSignup(id: string): Promise<void> {
  await getPool().query(
    `update signups
     set payment_status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = $1 and payment_status <> 'cancelled'`,
    [id]
  );
}

/**
 * Archive a customer who booked and never paid: moves them out of the active list and off the
 * schedule (every schedule/workload query only looks at 'active' and 'booked'). Nothing is
 * deleted - the row, payments and visit history all stay. Only an unpaid signup can be archived;
 * a paying customer is paused or cancelled instead. Returns false if nothing matched.
 *
 * No PayFast code changes for this: /api/pay/[token] already refuses anything that isn't
 * 'booked', and if a payment does come through for an archived row the existing ITN activation
 * simply sets it 'active' again, so a customer who pays later restores themselves.
 */
export async function archiveSignup(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update signups set payment_status = 'archived', updated_at = now()
     where id = $1 and payment_status in ('booked', 'pending', 'failed')`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/** Brings an archived customer back as 'booked' (awaiting payment) - back on the schedule, ready for a fresh payment link. */
export async function restoreSignup(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    "update signups set payment_status = 'booked', updated_at = now() where id = $1 and payment_status = 'archived'",
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * "Record a payment" for an EFT/cash customer - a manual counterpart to recordPayment
 * (the PayFast ITN path). pf_payment_id stays null (nothing to dedupe against; the owner
 * only taps this once per real payment), method is always 'eft' or 'cash' so it's never
 * confused with a real PayFast transaction in the revenue breakdown.
 */
export async function recordManualPayment(
  signupId: string,
  amount: number,
  method: "eft" | "cash",
  receivedAt: string | null
): Promise<void> {
  await getPool().query(
    `insert into payments (signup_id, amount, pf_payment_id, method, received_at)
     values ($1, $2, null, $3, coalesce($4::date::timestamptz, now()))`,
    [signupId, amount, method, receivedAt]
  );
}

/**
 * Correctly attributes each active signup to the date(s) it's actually due on, given the
 * given date range: a slot/scheduled-date match UNLESS that specific date has a
 * skipped_visits row moving it away (original_date = that date), plus anyone moved onto
 * that date from elsewhere (rescheduled_date = that date, regardless of whether their
 * original date is in `dates` at all). This is what the Week view was missing before (it
 * only checked the raw slot/date match, so a moved visit showed on its old day and never
 * on its new one) - fixed here and reused by both the Week route and the owner calendar.
 */
/**
 * node-postgres parses a `date` column into a real JS Date object even though SignupRow
 * types it as `string | null` (every OTHER consumer of this field casts `::text` in SQL
 * to sidestep this - getActiveVisitsForDates' `select *` doesn't, since its other callers
 * never do a JS-level string comparison on it). Needed here because getVisitsGroupedByDate
 * does. toDateKey's local-getter approach is timezone-safe regardless: node-postgres always
 * constructs the Date via the local Date constructor from the stored y/m/d, so reading it
 * back with local getters recovers the same y/m/d in any process timezone.
 */
export function asDateKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return toDateKey(value);
  return value as string;
}

export async function getVisitsGroupedByDate(dates: string[]): Promise<Map<string, SignupRow[]>> {
  const pool = await getActiveVisitsForDates(dates);
  if (dates.length === 0 || pool.length === 0) return new Map(dates.map((d) => [d, []]));

  const { rows: skipRows } = await getPool().query<{
    signup_id: string;
    original_date: string;
    rescheduled_date: string;
  }>(
    `select signup_id, original_date::text, rescheduled_date::text
     from skipped_visits
     where original_date = any($1::date[]) or rescheduled_date = any($1::date[])`,
    [dates]
  );
  const movedAway = new Map<string, Set<string>>();
  const movedTo = new Map<string, Set<string>>();
  for (const row of skipRows) {
    if (!movedAway.has(row.signup_id)) movedAway.set(row.signup_id, new Set());
    movedAway.get(row.signup_id)!.add(row.original_date);
    if (!movedTo.has(row.signup_id)) movedTo.set(row.signup_id, new Set());
    movedTo.get(row.signup_id)!.add(row.rescheduled_date);
  }

  const [ctx, drivenSkips] = await Promise.all([getRoutingContext(), getDrivenSkips()]);
  const todayKey = toDateKey(nowInJohannesburg());
  const dueCache = new Map<string, string>();
  const dueOf = (s: PooledSignup): string => {
    let due = dueCache.get(s.id);
    if (due === undefined) {
      due = effectiveDueDate(s.next_due_key!, drivenSkips.get(s.id) ?? [], ctx.workingDays, ctx.blocked);
      dueCache.set(s.id, due);
    }
    return due;
  };

  const result = new Map<string, SignupRow[]>();
  for (const dateKey of dates) {
    const slot = candidateSlotForDate(new Date(`${dateKey}T00:00:00`));
    const workable = isWorkingDay(new Date(`${dateKey}T00:00:00`), ctx.workingDays) && !ctx.blocked.has(dateKey);
    const customers = pool.filter((s) => {
      if (isDateDriven({ plan: s.plan, next_service_date: s.next_due_key, routing_from: s.routing_from_key }, dateKey)) {
        // Routed by the next service date: its own day, plus today's overdue (a forecast never repeats them).
        const status = dueStatusOn(dateKey, todayKey, dueOf(s));
        return status === "due" || (status === "overdue" && dateKey === todayKey && workable);
      }
      if (movedAway.get(s.id)?.has(dateKey)) return false;
      if (movedTo.get(s.id)?.has(dateKey)) return true;
      return (slot !== null && s.service_slot === slot) || asDateKey(s.scheduled_visit_date) === dateKey;
    });
    result.set(dateKey, customers);
  }
  return result;
}

export interface CalendarPerson {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
}

export interface CalendarServiced extends CalendarPerson {
  worker: string | null;
  note: string | null;
}

export interface CalendarDue extends CalendarPerson {
  /** Due on a day that has passed with no visit recorded since. */
  overdue: boolean;
  /** Worked out by repeating the usual interval from the client's next date - not a date anyone has set. */
  projected: boolean;
}

export interface ServiceCalendarDay {
  date: string;
  blocked: boolean;
  blockedLabel: string | null;
  serviced: CalendarServiced[];
  due: CalendarDue[];
}

/**
 * Owner month calendar covering every client: who was serviced on each day (a visit record exists) and who is
 * due (their next service date falls there, or fell there and they are still overdue). Future months repeat
 * each client's usual interval from their next date, marked projected so it is never mistaken for a booking.
 */
export async function getServiceCalendar(year: number, month1: number): Promise<ServiceCalendarDay[]> {
  const total = new Date(year, month1, 0).getDate();
  const dateKeys = Array.from({ length: total }, (_, i) => toDateKey(new Date(year, month1 - 1, i + 1)));
  const first = dateKeys[0];
  const last = dateKeys[dateKeys.length - 1];
  const todayKey = toDateKey(nowInJohannesburg());
  const pool = getPool();

  const [{ rows: clients }, { rows: visitRows }, ctx, drivenSkips, blockedDates, legacy] = await Promise.all([
    pool.query<{
      id: string;
      full_name: string;
      house_number: string;
      block: number | null;
      plan: PlanId;
      paused: boolean;
      next_service_date: string | null;
      routing_from: string | null;
    }>(
      `select id, full_name, house_number, block, plan, paused_at is not null as paused,
              next_service_date::text, routing_from::text
       from signups where payment_status in ('active', 'booked')`
    ),
    pool.query<{
      signup_id: string;
      service_date: string;
      crew: string | null;
      note: string | null;
      full_name: string;
      house_number: string;
      block: number | null;
      plan: PlanId;
    }>(
      `select v.signup_id, v.service_date::text, v.crew, v.note, s.full_name, s.house_number, s.block, s.plan
       from service_visits v join signups s on s.id = v.signup_id
       where v.service_date between $1::date and $2::date
       order by lower(s.full_name)`,
      [first, last]
    ),
    getRoutingContext(),
    getDrivenSkips(),
    getBlockedDates(),
    getVisitsGroupedByDate(dateKeys),
  ]);

  const blockedByDate = new Map(blockedDates.map((b) => [b.date, b.label]));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const days = new Map<string, ServiceCalendarDay>(
    dateKeys.map((d) => [
      d,
      { date: d, blocked: blockedByDate.has(d), blockedLabel: blockedByDate.get(d) ?? null, serviced: [], due: [] },
    ])
  );
  const servicedKey = new Set<string>();
  for (const v of visitRows) {
    servicedKey.add(`${v.signup_id}|${v.service_date}`);
    days.get(v.service_date)?.serviced.push({
      id: v.signup_id,
      fullName: v.full_name,
      houseNumber: v.house_number,
      block: v.block,
      plan: v.plan,
      worker: v.crew,
      note: v.note,
    });
  }
  const person = (c: { id: string; full_name: string; house_number: string; block: number | null; plan: PlanId }): CalendarPerson => ({
    id: c.id,
    fullName: c.full_name,
    houseNumber: c.house_number,
    block: c.block,
    plan: c.plan,
  });

  for (const c of clients) {
    if (c.paused || !isDateDriven(c, "9999-12-31")) continue;
    const due = effectiveDueDate(c.next_service_date!, drivenSkips.get(c.id) ?? [], ctx.workingDays, ctx.blocked);
    // The date itself - unless a visit is already recorded that day, in which case they were serviced.
    if (due >= first && due <= last && !servicedKey.has(`${c.id}|${due}`)) {
      days.get(due)?.due.push({ ...person(c), overdue: due < todayKey, projected: false });
    }
    // Then repeat the usual interval, assuming each visit happens on its date (an overdue one, today at the latest).
    let cursor = due < todayKey ? todayKey : due;
    for (let i = 0; i < 40 && cursor <= last; i++) {
      const projected = effectiveDueDate(suggestNextServiceDate(cursor), [], ctx.workingDays, ctx.blocked);
      if (projected >= first && projected <= last && projected > todayKey) {
        days.get(projected)?.due.push({ ...person(c), overdue: false, projected: true });
      }
      cursor = projected;
    }
  }

  // Clients still on the old fixed days (and once-off bookings): whatever the old schedule says for today and
  // later, minus anyone serviced. Days already gone show visit records only - the old schedule's guess about a
  // past day is not a fact, and an overdue client is found by their next service date, never by a past slot.
  for (const d of dateKeys) {
    if (d < todayKey) continue;
    for (const row of legacy.get(d) ?? []) {
      const client = byId.get(row.id);
      if (client && isDateDriven(client, d)) continue;
      if (servicedKey.has(`${row.id}|${d}`)) continue;
      days.get(d)?.due.push({
        id: row.id,
        fullName: row.full_name,
        houseNumber: row.house_number,
        block: row.block,
        plan: row.plan,
        overdue: false,
        projected: false,
      });
    }
  }

  const byBlock = (x: CalendarPerson, y: CalendarPerson) =>
    (x.block ?? Infinity) - (y.block ?? Infinity) || x.houseNumber.localeCompare(y.houseNumber, undefined, { numeric: true });
  const out = dateKeys.map((d) => days.get(d)!);
  for (const day of out) {
    day.serviced.sort(byBlock);
    day.due.sort(byBlock);
  }
  return out;
}

export interface ServiceStatusClient {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
  paused: boolean;
  lastVisitDate: string | null;
  lastVisitWorker: string | null;
  nextServiceDate: string | null;
  overdueSince: string | null;
}

/** Every client with last service, who did it, next service date and overdue flag - overdue first, then soonest due. */
export async function getServiceStatus(): Promise<{ clients: ServiceStatusClient[]; overdueCount: number }> {
  const all = await getOpsClients();
  const clients: ServiceStatusClient[] = all.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    houseNumber: c.houseNumber,
    block: c.block,
    plan: c.plan,
    paused: c.paused,
    lastVisitDate: c.lastVisitDate,
    lastVisitWorker: c.lastVisitWorker,
    nextServiceDate: c.nextServiceDate,
    overdueSince: c.overdueSince,
  }));
  const overdue = groupByBlock(clients.filter((c) => c.overdueSince !== null)).flatMap((g) => g.customers);
  const rest = clients
    .filter((c) => c.overdueSince === null)
    .sort((a, b) => {
      if (a.nextServiceDate === b.nextServiceDate) return a.fullName.localeCompare(b.fullName);
      if (a.nextServiceDate === null) return 1;
      if (b.nextServiceDate === null) return -1;
      return a.nextServiceDate < b.nextServiceDate ? -1 : 1;
    });
  return { clients: [...overdue, ...rest], overdueCount: overdue.length };
}

export interface SubscriptionRow {
  id: string;
  fullName: string;
  houseNumber: string;
  plan: PlanId;
  method: SignupRow["payment_method"];
  status: SignupRow["payment_status"];
  paused: boolean;
  /** The day the subscription started (first activation) - null until they are actually subscribed. */
  subscribedOn: string | null;
  /** The next debit - null once cancelled/archived and for anyone not subscribed yet. */
  nextDebit: string | null;
  lastPaymentFailed: boolean;
}

/**
 * Every subscriber (monthly and annual) with the day they subscribed and their next debit. PayFast customers
 * are anchored to the subscription date, EFT and cash customers roll forward from it - see lib/billing.ts.
 */
export async function getSubscriptions(): Promise<SubscriptionRow[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    plan: PlanId;
    payment_method: SignupRow["payment_method"];
    payment_status: SignupRow["payment_status"];
    paused: boolean;
    start_date: string | null;
    last_payment_failed_at: string | null;
  }>(
    `select id, full_name, house_number, plan, payment_method, payment_status, paused_at is not null as paused,
            start_date::text, last_payment_failed_at
     from signups
     where plan <> 'once-off' and payment_status in ('active', 'booked', 'cancelled', 'archived')`
  );
  const todayKey = toDateKey(nowInJohannesburg());
  const list: SubscriptionRow[] = rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    plan: r.plan,
    method: r.payment_method,
    status: r.payment_status,
    paused: r.paused,
    subscribedOn: r.start_date,
    nextDebit:
      r.payment_status === "active" && r.start_date
        ? nextDebitDate({ subscribedOn: r.start_date, plan: r.plan, method: r.payment_method, today: todayKey })
        : null,
    lastPaymentFailed: r.last_payment_failed_at !== null,
  }));
  const rank = (x: SubscriptionRow) => (x.nextDebit ? 0 : x.status === "booked" ? 1 : 2);
  return list.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.nextDebit && b.nextDebit && a.nextDebit !== b.nextDebit) return a.nextDebit < b.nextDebit ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

/** Same row shape as getAllCustomers, filtered to one customer - backs the owner profile page. */
export async function getCustomerDetail(id: string): Promise<CustomerRow | null> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    plan: PlanId;
    payment_status: SignupRow["payment_status"];
    payment_method: SignupRow["payment_method"];
    block: number | null;
    service_slot: number | null;
    scheduled_visit_date: string | null;
    notes: string | null;
    paused_at: string | null;
    awaiting_days: number | null;
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, payment_status, payment_method,
            block, service_slot, scheduled_visit_date::text, notes, paused_at,
            case when payment_status = 'booked' then floor(extract(epoch from (now() - created_at)) / 86400)::int end as awaiting_days
     from signups where id = $1`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  const overdue = (await getFailedOrOverdueCustomers()).some((c) => c.id === r.id);
  return {
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    plan: r.plan,
    paymentStatus: r.payment_status,
    paymentMethod: r.payment_method,
    block: r.block,
    serviceSlot: r.service_slot,
    scheduledVisitDate: r.scheduled_visit_date,
    notes: r.notes,
    pausedAt: r.paused_at,
    awaitingPaymentDays: r.awaiting_days,
    overdue,
  };
}

/** Public customer-tracking page (/track/[token]) looks a signup up by its unguessable token. */
export async function getSignupByTrackingToken(token: string): Promise<SignupRow | null> {
  const { rows } = await getPool().query<SignupRow>("select * from signups where tracking_token = $1 limit 1", [
    token,
  ]);
  return rows[0] ?? null;
}

/** Dates the customer's yard was actually done - the public tracking page's visit history.
 * Deliberately excludes skipped/moved reasons (those are internal ops detail, not
 * something a customer-facing summary needs to show). */
export async function getCompletedVisitDates(signupId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ date: string }>(
    "select service_date::text as date from service_visits where signup_id = $1 order by service_date desc",
    [signupId]
  );
  return rows.map((r) => r.date);
}

export interface CustomerHistoryEntry {
  date: string;
  status: "completed" | SkipOrMoveReason;
  rescheduledDate: string | null;
}

/** Owner profile's "full visit history with dates and status" - completed visits plus
 * every skip/move, merged into one timeline (internal-facing, unlike getCompletedVisitDates). */
export async function getCustomerHistory(signupId: string): Promise<CustomerHistoryEntry[]> {
  const [{ rows: visits }, { rows: skips }] = await Promise.all([
    getPool().query<{ date: string }>(
      "select service_date::text as date from service_visits where signup_id = $1",
      [signupId]
    ),
    getPool().query<{ date: string; reason: SkipOrMoveReason; rescheduled_date: string }>(
      "select original_date::text as date, reason, rescheduled_date::text from skipped_visits where signup_id = $1",
      [signupId]
    ),
  ]);
  const entries: CustomerHistoryEntry[] = [
    ...visits.map((v) => ({ date: v.date, status: "completed" as const, rescheduledDate: null })),
    ...skips.map((s) => ({ date: s.date, status: s.reason, rescheduledDate: s.rescheduled_date })),
  ];
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

export interface PaymentHistoryEntry {
  amount: number;
  method: "payfast" | "eft" | "cash";
  receivedAt: string;
}

export async function getPaymentHistory(signupId: string): Promise<PaymentHistoryEntry[]> {
  const { rows } = await getPool().query<{ amount: string; method: "payfast" | "eft" | "cash"; received_at: string }>(
    "select amount, method, received_at from payments where signup_id = $1 order by received_at desc",
    [signupId]
  );
  return rows.map((r) => ({ amount: Number(r.amount), method: r.method, receivedAt: r.received_at }));
}

/**
 * nextServiceDate (lib/schedule.ts) is a pure function of the recurring slot/scheduled-date
 * only - it has no idea a specific occurrence was ever moved. This follows that raw date
 * through any chain of skipped_visits moves (original_date -> rescheduled_date) so "next
 * service date" is correct after a move, not just before one. Capped at 5 hops as a safety
 * net against a pathological cycle; a real chain of moves is never anywhere near that long.
 */
export async function getEffectiveNextServiceDate(
  signupId: string,
  signup: { service_slot: number | null; scheduled_visit_date: string | null },
  from: Date
): Promise<Date | null> {
  const { rows: meta } = await getPool().query<{
    plan: string;
    next_service_date: string | null;
    routing_from: string | null;
    skips: { original_date: string; rescheduled_date: string }[];
  }>(
    `select s.plan, s.next_service_date::text as next_service_date, s.routing_from::text as routing_from,
            coalesce((select json_agg(json_build_object('original_date', sv.original_date::text, 'rescheduled_date', sv.rescheduled_date::text))
                      from skipped_visits sv
                      where sv.signup_id = s.id and s.next_service_date is not null and sv.original_date >= s.next_service_date), '[]'::json) as skips
     from signups s where s.id = $1`,
    [signupId]
  );
  const todayKey = toDateKey(from);
  if (meta[0] && isDateDriven(meta[0], todayKey)) {
    const ctx = await getRoutingContextCached();
    const due = effectiveDueDate(meta[0].next_service_date!, meta[0].skips, ctx.workingDays, ctx.blocked);
    // An overdue client is next seen today, not in the past.
    return new Date(`${due < todayKey ? todayKey : due}T00:00:00`);
  }
  const raw = nextServiceDate(signup, from);
  if (!raw) return null;
  let candidate = raw;
  for (let i = 0; i < 5; i++) {
    const key = toDateKey(candidate);
    const { rows } = await getPool().query<{ rescheduled_date: string }>(
      "select rescheduled_date::text from skipped_visits where signup_id = $1 and original_date = $2::date",
      [signupId, key]
    );
    if (!rows[0]) break;
    candidate = new Date(`${rows[0].rescheduled_date}T00:00:00`);
  }
  return candidate;
}

/** Sets last_contacted_at - called whenever any WhatsApp button fires from /ops or /owner. */
export async function recordContact(signupId: string): Promise<void> {
  await getPool().query("update signups set last_contacted_at = now() where id = $1", [signupId]);
}

export interface MessageCentreCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  lastContactedAt: string | null;
}

/** Message centre - every non-cancelled customer, oldest/never-contacted first, so the
 * owner can see at a glance who they haven't spoken to. */
export async function getMessageCentreList(): Promise<MessageCentreCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    whatsapp_number: string;
    last_contacted_at: string | null;
  }>(
    `select id, full_name, house_number, whatsapp_number, last_contacted_at
     from signups
     where payment_status not in ('cancelled', 'archived')
     order by last_contacted_at asc nulls first, full_name asc`
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    houseNumber: r.house_number,
    whatsappNumber: r.whatsapp_number,
    lastContactedAt: r.last_contacted_at,
  }));
}
// ---------------------------------------------------------------------------------------------
// Customer reviews
// ---------------------------------------------------------------------------------------------

export type ReviewAction = "approve" | "hide" | "unhide" | "reply";

/**
 * The block to show beside a review on the public site: the block of the customer(s) whose phone number
 * matches, but only when that is unambiguous (one distinct block). No match, or a match with no block
 * recorded, shows the first name alone. The reviewer is never asked for a block - it comes from our own records.
 */
const REVIEW_SITE_BLOCK_SQL = `(select case when count(distinct s.block) = 1 then max(s.block) end
                                 from signups s where s.whatsapp_number = r.phone)`;

/**
 * Stores a new review as 'pending'. The rate limit is part of the insert itself, so concurrent requests
 * from one address can't slip past it: returns 'rate_limited' when this address already has too many.
 */
export async function createReview(input: {
  name: string;
  phone: string;
  rating: number;
  comment: string;
  ipHash: string;
  maxPerHour: number;
  maxPerDay: number;
}): Promise<"ok" | "rate_limited"> {
  const { rowCount } = await getPool().query(
    `insert into reviews (name, phone, rating, comment, ip_hash)
     select $1::text, $2::text, $3::smallint, $4::text, $5::text
     where (select count(*) from reviews where ip_hash = $5::text and created_at > now() - interval '1 hour') < $6::int
       and (select count(*) from reviews where ip_hash = $5::text and created_at > now() - interval '1 day') < $7::int`,
    [input.name, input.phone, input.rating, input.comment, input.ipHash, input.maxPerHour, input.maxPerDay]
  );
  return (rowCount ?? 0) > 0 ? "ok" : "rate_limited";
}

export interface PublicReview {
  id: string;
  firstName: string;
  block: number | null;
  rating: number;
  comment: string;
  reply: string | null;
}

/** Approved and not hidden, newest first. Only a first name and a block leave this query - no phone, no surname, no address. */
export async function getPublicReviews(limit = 30): Promise<PublicReview[]> {
  const { rows } = await getPool().query<{
    id: string;
    first_name: string;
    block: number | null;
    rating: number;
    comment: string;
    reply: string | null;
  }>(
    `select r.id, left(split_part(btrim(r.name), ' ', 1), 40) as first_name,
            ${REVIEW_SITE_BLOCK_SQL} as block, r.rating, r.comment, r.reply
     from reviews r
     where r.status = 'approved' and not r.hidden
     order by r.created_at desc
     limit $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    block: r.block,
    rating: r.rating,
    comment: r.comment,
    reply: r.reply,
  }));
}

export interface ReviewCustomerMatch {
  fullName: string;
  houseNumber: string;
  block: number | null;
  status: string;
}

export interface OwnerReview {
  id: string;
  name: string;
  phone: string;
  rating: number;
  comment: string;
  status: "pending" | "approved";
  hidden: boolean;
  reply: string | null;
  createdAt: string;
  /** Customers on our list with this phone number - empty means no match. Current customers first. */
  matches: ReviewCustomerMatch[];
  /** Block that would show on the public site beside this review. */
  siteBlock: number | null;
}

/** Everything, with the phone matched against the customer list. Pending (not hidden) first so the queue is at the top. */
export async function getOwnerReviews(): Promise<OwnerReview[]> {
  const { rows } = await getPool().query<{
    id: string;
    name: string;
    phone: string;
    rating: number;
    comment: string;
    status: "pending" | "approved";
    hidden: boolean;
    reply: string | null;
    created_at: string;
    matches: { fullName: string; houseNumber: string; block: number | null; status: string }[];
    site_block: number | null;
  }>(
    `select r.id, r.name, r.phone, r.rating, r.comment, r.status, r.hidden, r.reply, r.created_at,
            coalesce((select json_agg(json_build_object(
                        'fullName', s.full_name, 'houseNumber', s.house_number, 'block', s.block, 'status', s.payment_status)
                        order by (s.payment_status in ('active', 'booked')) desc, s.created_at desc)
                      from signups s where s.whatsapp_number = r.phone), '[]'::json) as matches,
            ${REVIEW_SITE_BLOCK_SQL} as site_block
     from reviews r
     order by (r.status = 'pending' and not r.hidden) desc, r.created_at desc`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    hidden: r.hidden,
    reply: r.reply,
    createdAt: r.created_at,
    matches: r.matches,
    siteBlock: r.site_block,
  }));
}

export async function getPendingReviewCount(): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    "select count(*)::int as n from reviews where status = 'pending' and not hidden"
  );
  return rows[0]?.n ?? 0;
}

/** Approve publishes (and un-hides). Hide/unhide only flip the flag. Reply sets or, when empty, clears the reply. */
export async function moderateReview(id: string, action: ReviewAction, reply?: string): Promise<boolean> {
  const pool = getPool();
  let rowCount: number | null;
  if (action === "approve") {
    ({ rowCount } = await pool.query(
      "update reviews set status = 'approved', hidden = false, updated_at = now() where id = $1",
      [id]
    ));
  } else if (action === "hide") {
    ({ rowCount } = await pool.query("update reviews set hidden = true, updated_at = now() where id = $1", [id]));
  } else if (action === "unhide") {
    ({ rowCount } = await pool.query("update reviews set hidden = false, updated_at = now() where id = $1", [id]));
  } else {
    const text = (reply ?? "").trim();
    ({ rowCount } = await pool.query(
      `update reviews set reply = nullif($2::text, ''),
              replied_at = case when $2::text = '' then null else now() end,
              updated_at = now()
       where id = $1`,
      [id, text]
    ));
  }
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// Record a visit, next service date and workers (ops "Clients")
// ---------------------------------------------------------------------------------------------

export interface Worker {
  id: string;
  name: string;
}

export async function listWorkers(): Promise<Worker[]> {
  const { rows } = await getPool().query<Worker>("select id, name from workers order by lower(name)");
  return rows;
}

/** Null when a worker with that name (any capitalisation) is already on the list. */
export async function addWorker(name: string): Promise<Worker | null> {
  const { rows } = await getPool().query<Worker>(
    "insert into workers (name) values ($1) on conflict do nothing returning id, name",
    [name]
  );
  return rows[0] ?? null;
}

/** Past visits keep the worker's name (it is copied onto each visit), so removing someone changes no history. */
export async function removeWorker(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query("delete from workers where id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

export async function getWorker(id: string): Promise<Worker | null> {
  const { rows } = await getPool().query<Worker>("select id, name from workers where id = $1", [id]);
  return rows[0] ?? null;
}

export interface OpsClient {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
  paused: boolean;
  lastVisitDate: string | null;
  lastVisitWorker: string | null;
  nextServiceDate: string | null;
  nextServiceDateManual: boolean;
  /** The day they are really due (their next date after any move, rolled off days off) - null if not date-routed. */
  dueDate: string | null;
  /** Set when that day has passed and they have no visit since: they are overdue. Never for paused clients. */
  overdueSince: string | null;
}

/** Clients on the service list (active and booked). Last visit comes from the most recent visit record, whoever recorded it. */
export async function getOpsClients(): Promise<OpsClient[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    block: number | null;
    plan: PlanId;
    paused: boolean;
    last_visit_date: string | null;
    last_visit_worker: string | null;
    next_service_date: string | null;
    next_service_date_manual: boolean;
    routing_from: string | null;
  }>(
    `select s.id, s.full_name, s.house_number, s.block, s.plan, s.paused_at is not null as paused,
            lv.service_date::text as last_visit_date, lv.crew as last_visit_worker,
            s.next_service_date::text, s.next_service_date_manual, s.routing_from::text
     from signups s
     left join lateral (
       select v.service_date, v.crew from service_visits v
       where v.signup_id = s.id order by v.service_date desc limit 1
     ) lv on true
     where s.payment_status in ('active', 'booked')
     order by lower(s.full_name)`
  );
  const [ctx, drivenSkips] = await Promise.all([getRoutingContext(), getDrivenSkips()]);
  const todayKey = toDateKey(nowInJohannesburg());
  return rows.map((r) => {
    const driven = isDateDriven(r, todayKey);
    const dueDate = driven
      ? effectiveDueDate(r.next_service_date!, drivenSkips.get(r.id) ?? [], ctx.workingDays, ctx.blocked)
      : null;
    return {
      id: r.id,
      fullName: r.full_name,
      houseNumber: r.house_number,
      block: r.block,
      plan: r.plan,
      paused: r.paused,
      lastVisitDate: r.last_visit_date,
      lastVisitWorker: r.last_visit_worker,
      nextServiceDate: r.next_service_date,
      nextServiceDateManual: r.next_service_date_manual,
      dueDate,
      overdueSince: dueDate !== null && dueDate < todayKey && !r.paused ? dueDate : null,
    };
  });
}

/** Clients whose next service date has passed, in walking order (block, then house number). */
export async function getOverdueClients(): Promise<OpsClient[]> {
  const overdue = (await getOpsClients()).filter((c) => c.overdueSince !== null);
  return groupByBlock(overdue).flatMap((g) => g.customers);
}

export interface ClientVisit {
  serviceDate: string;
  worker: string | null;
  note: string | null;
  confirmed: boolean;
}

/** One client plus their visit history, newest first. */
export async function getOpsClientDetail(id: string): Promise<{ client: OpsClient; visits: ClientVisit[] } | null> {
  const client = (await getOpsClients()).find((c) => c.id === id);
  if (!client) return null;
  const { rows } = await getPool().query<{
    service_date: string;
    crew: string | null;
    note: string | null;
    confirmed: boolean;
  }>(
    `select service_date::text, crew, note, confirmed_at is not null as confirmed
     from service_visits where signup_id = $1 order by service_date desc limit 40`,
    [id]
  );
  return {
    client,
    visits: rows.map((r) => ({ serviceDate: r.service_date, worker: r.crew, note: r.note, confirmed: r.confirmed })),
  };
}

export type NextDateReason = "set" | "later_visit" | "once_off" | "inactive";

export type RecordVisitResult =
  | { ok: true; updatedExisting: boolean; nextServiceDate: string | null; nextDateUpdated: boolean; nextDateReason: NextDateReason }
  | { ok: false; reason: "not_found" | "flagged" };

/**
 * "Record a visit": a service record for `serviceDate` (any past date), by `worker`, with an optional note.
 * Recording the same date again corrects the worker/note instead of duplicating (one record per client per day).
 * A yard flagged Not done or moved on that day is refused - that has to be unflagged on the day's route first,
 * so a day can never say both done and not done.
 *
 * The next service date is then suggested from the recorded date, but only when this is the client's latest
 * visit - capturing an old visit days late must not overwrite a date worked out from a newer one. It replaces
 * a hand-set date too (that is what recording a visit means), and the owner can change it again at any time.
 */
export async function recordVisit(input: {
  signupId: string;
  serviceDate: string;
  worker: string;
  note: string | null;
}): Promise<RecordVisitResult> {
  const pool = getPool();
  const { rows: signupRows } = await pool.query<{ payment_status: string; plan: string }>(
    "select payment_status, plan from signups where id = $1",
    [input.signupId]
  );
  if (!signupRows[0]) return { ok: false, reason: "not_found" };
  const recurring = signupRows[0].plan !== "once-off";
  const live = ["active", "booked"].includes(signupRows[0].payment_status);

  const { rows: flagged } = await pool.query(
    "select 1 from skipped_visits where signup_id = $1 and original_date = $2::date",
    [input.signupId, input.serviceDate]
  );
  if (flagged.length > 0) return { ok: false, reason: "flagged" };

  const written = await writeVisitRecord({
    signupId: input.signupId,
    serviceDate: input.serviceDate,
    worker: input.worker,
    note: input.note,
    overwrite: true,
  });
  const rowCount = written.nextDateUpdated ? 1 : 0;

  const { rows: current } = await pool.query<{ next_service_date: string | null }>(
    "select next_service_date::text from signups where id = $1",
    [input.signupId]
  );
  return {
    ok: true,
    updatedExisting: !written.inserted,
    nextServiceDate: current[0]?.next_service_date ?? null,
    nextDateUpdated: (rowCount ?? 0) > 0,
    nextDateReason: (rowCount ?? 0) > 0 ? "set" : !recurring ? "once_off" : !live ? "inactive" : "later_visit",
  };
}

/**
 * Hand-set (or clear) the next service date. Never locked: recording a later visit recalculates it. Setting
 * one starts routing by it from `todayKey`; clearing it hands the client back to the old fixed slot.
 */
export async function setNextServiceDate(
  signupId: string,
  date: string | null,
  todayKey: string
): Promise<"ok" | "not_found" | "once_off"> {
  const { rows } = await getPool().query<{ plan: string }>("select plan from signups where id = $1", [signupId]);
  if (!rows[0]) return "not_found";
  if (rows[0].plan === "once-off") return "once_off";
  await getPool().query(
    `update signups set next_service_date = $2::date, next_service_date_manual = ($2::date is not null),
            routing_from = case when $2::date is not null then coalesce(routing_from, $3::date) else routing_from end,
            updated_at = now()
     where id = $1`,
    [signupId, date, todayKey]
  );
  return "ok";
}
