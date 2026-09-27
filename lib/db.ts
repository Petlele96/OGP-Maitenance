import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PLANS, type PlanId, isSubscriberPlan } from "./plans";
import {
  toDateKey,
  visitDaysForSlotInMonth,
  candidateSlotForDate,
  eligibleSlotsForNewSignup,
  addWorkingDays,
  nextWorkingDay,
  nowInJohannesburg,
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
  payment_status: "booked" | "pending" | "active" | "failed" | "cancelled";
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
  notes: string | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The least-loaded slot among `eligibleSlots`, ties broken by lowest slot number.
 * Restricted to slots that still give at least MIN_NOTICE_WORKING_DAYS of notice (see
 * eligibleSlotsForNewSignup) - load-balancing only ever chooses among those, so a new
 * signup's first visit never lands too soon.
 */
async function pickLeastLoadedSlot(eligibleSlots: number[]): Promise<number> {
  const { rows } = await getPool().query<{ slot: number; count: string }>(
    `select gs as slot, count(s.id) as count
     from unnest($1::int[]) as gs
     left join signups s on s.service_slot = gs and s.payment_status = 'active'
     group by gs
     order by count(s.id) asc, gs asc
     limit 1`,
    [eligibleSlots]
  );
  return rows[0].slot;
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
  // Once-off bookings don't recur, so there's no bi-monthly slot to assign.
  const slot = isSubscriberPlan(input.plan)
    ? await pickLeastLoadedSlot(eligibleSlotsForNewSignup(now, workingDays))
    : null;
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
    `insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id, service_slot, terms_accepted_at, block, payment_status, scheduled_visit_date)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11)
     returning *`,
    [
      id,
      input.fullName,
      input.houseNumber,
      input.whatsappNumber,
      input.plan,
      input.amount,
      id,
      slot,
      input.block,
      input.paymentStatus,
      scheduledVisitDate,
    ]
  );
  return rows[0];
}

/** Direct signup-and-pay-now - unchanged behaviour, just routed through insertSignup. */
export async function createSignup(
  input: Omit<InsertSignupInput, "paymentStatus">
): Promise<SignupRow> {
  return insertSignup({ ...input, paymentStatus: "pending" });
}

/** Stage 1 of the book-then-pay flow - no PayFast interaction, just a service day reserved. */
export async function createBooking(
  input: Omit<InsertSignupInput, "paymentStatus">
): Promise<SignupRow> {
  return insertSignup({ ...input, paymentStatus: "booked" });
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
 * Active signups due on any of the given dates - subscribers via their recurring
 * service_slot (candidateSlotForDate), once-off bookings via their single
 * scheduled_visit_date, and anyone bumped onto one of these dates by a "Can't do" skip
 * (skipped_visits.rescheduled_date). These three never double-match the same row for the
 * same visit (a subscriber's scheduled_visit_date is always null, a once-off's
 * service_slot is always null, and a skip's rescheduled_date is a fresh one-off date), so
 * a customer appears at most once per date even though up to three conditions could
 * technically be true. Unordered - callers sort/group with lib/sort.ts (a plain SQL text
 * order misorders numeric house numbers).
 */
export async function getActiveVisitsForDates(dates: string[]): Promise<SignupRow[]> {
  if (dates.length === 0) return [];
  const slots = Array.from(
    new Set(
      dates
        .map((d) => candidateSlotForDate(new Date(`${d}T00:00:00`)))
        .filter((s): s is number => s !== null)
    )
  );
  const { rows } = await getPool().query<SignupRow>(
    `select * from signups
     where payment_status = 'active'
       and paused_at is null
       and (
         service_slot = any($1::int[])
         or scheduled_visit_date = any($2::date[])
         or exists (
           select 1 from skipped_visits sv
           where sv.signup_id = signups.id and sv.rescheduled_date = any($2::date[])
         )
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

/** Idempotent: tapping Done twice for the same customer/day returns the original completed_at. */
export async function markVisitDone(signupId: string, date: string): Promise<ServiceVisitRow> {
  const { rows } = await getPool().query<ServiceVisitRow>(
    `insert into service_visits (signup_id, service_date)
     values ($1, $2)
     on conflict (signup_id, service_date) do update set signup_id = excluded.signup_id
     returning signup_id, service_date::text, completed_at`,
    [signupId, date]
  );
  return rows[0];
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

/** Records a "Can't do" on today's visit and bumps the customer to the next working day. */
export async function recordSkippedVisit(signupId: string, reason: SkipReason): Promise<SkippedVisitRow> {
  const { workingDays } = await getAppSettings();
  const originalDate = toDateKey(nowInJohannesburg());
  const rescheduledDate = toDateKey(nextWorkingDay(nowInJohannesburg(), workingDays));
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
     where s.payment_status = 'active'
       and s.paused_at is null
       and (($4::int is not null and s.service_slot = $4) or s.scheduled_visit_date = $1::date)
       and not exists (select 1 from service_visits v where v.signup_id = s.id and v.service_date = $1::date)
       and not exists (select 1 from skipped_visits sv where sv.signup_id = s.id and sv.original_date = $1::date)
     on conflict (signup_id, original_date) do nothing
     returning signup_id`,
    [dateKey, rescheduledKey, reason, slot]
  );
  return rows.length;
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
    full_name: string;
    house_number: string;
    reason: SkipOrMoveReason;
    original_date: string;
    rescheduled_date: string;
  }>(
    `select sv.id, s.full_name, s.house_number, sv.reason, sv.original_date::text, sv.rescheduled_date::text
     from skipped_visits sv
     join signups s on s.id = sv.signup_id
     where sv.created_at >= ${SAST_MONTH_START_SQL}
       and sv.created_at < ${SAST_MONTH_START_SQL} + interval '1 month'
     order by sv.created_at desc`
  );
  return rows.map((r) => ({
    id: r.id,
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
  status: "failed" | "overdue";
}

/**
 * Three sources, merged: signups whose *first* payment never went through (still
 * 'pending' -> 'failed'); active signups with a *recurring* charge that failed
 * (last_payment_failed_at set by the ITN handler - still 'active', still on the
 * schedule, just needs chasing); and active signups with no recent failure but whose
 * last successful payment is older than one billing period (no grace period). The
 * second and third groups are mutually exclusive by construction (WHERE clauses below)
 * so nobody is double-listed.
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
    last_payment_at: string;
  }>(
    `select s.id, s.full_name, s.house_number, s.whatsapp_number, s.plan,
            coalesce(max(p.received_at), s.start_date::timestamptz, s.created_at) as last_payment_at
     from signups s
     left join payments p on p.signup_id = s.id
     where s.payment_status = 'active' and s.last_payment_failed_at is null
       and s.paused_at is null
       and s.plan in ('monthly', 'annual')
     group by s.id`
  );

  const overdue: FailedOrOverdueCustomer[] = [];
  for (const r of activeRows) {
    const nextDue = new Date(r.last_payment_at);
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
    "select service_slot from signups where payment_status = 'active' and paused_at is null and service_slot is not null"
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
}

/**
 * Active signups nobody's sent the WhatsApp welcome message to yet. Returns the raw
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
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, service_slot, scheduled_visit_date::text
     from signups
     where payment_status = 'active' and welcomed_at is null
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
  }));
}

export async function markWelcomed(id: string): Promise<void> {
  await getPool().query(
    "update signups set welcomed_at = now() where id = $1 and payment_status = 'active'",
    [id]
  );
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
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, block, service_slot,
            scheduled_visit_date::text, payment_link_sent_at, payment_link_expires_at::text, notes
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
  }>(
    `select id, full_name, house_number, whatsapp_number, plan, payment_status, payment_method,
            block, service_slot, scheduled_visit_date::text, notes, paused_at
     from signups
     order by created_at desc`
  );
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
  }));
}

export interface ManualSignupInput {
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

/**
 * "Add customer manually" on the owner page - creates the row exactly like a web signup
 * would (same slot/date defaulting when the owner leaves service day blank), except:
 * paymentMethod 'payfast' lands as 'booked' (the existing ops "Send payment link" flow
 * takes it from there), while 'eft'/'cash' land straight on 'active' - the owner is
 * vouching that this customer already pays outside PayFast, so there's no payment step
 * for the app to wait on.
 */
export async function createManualSignup(input: ManualSignupInput): Promise<SignupRow> {
  const id = randomUUID();
  const now = nowInJohannesburg();
  const subscriber = isSubscriberPlan(input.plan);
  const { workingDays } = await getAppSettings();

  const serviceSlot = subscriber
    ? input.serviceSlot ?? (await pickLeastLoadedSlot(eligibleSlotsForNewSignup(now, workingDays)))
    : null;
  const scheduledVisitDate = !subscriber
    ? input.scheduledVisitDate ?? toDateKey(addWorkingDays(now, MIN_NOTICE_WORKING_DAYS, workingDays))
    : null;

  const paymentStatus = input.paymentMethod === "payfast" ? "booked" : "active";
  const startDate = paymentStatus === "active" ? toDateKey(now) : null;

  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (
       id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id,
       service_slot, terms_accepted_at, block, payment_status, scheduled_visit_date,
       payment_method, notes, start_date
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13, $14)
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

  const result = new Map<string, SignupRow[]>();
  for (const dateKey of dates) {
    const slot = candidateSlotForDate(new Date(`${dateKey}T00:00:00`));
    const customers = pool.filter((s) => {
      if (movedAway.get(s.id)?.has(dateKey)) return false;
      if (movedTo.get(s.id)?.has(dateKey)) return true;
      return (slot !== null && s.service_slot === slot) || asDateKey(s.scheduled_visit_date) === dateKey;
    });
    result.set(dateKey, customers);
  }
  return result;
}

export interface CalendarDay {
  date: string;
  count: number;
  blocked: boolean;
  blockedLabel: string | null;
  customers: { id: string; fullName: string; houseNumber: string; plan: PlanId; block: number | null }[];
}

/** Owner-page month calendar - every scheduled visit in `year`-`month` (1-indexed), grouped by day. */
export async function getCalendarMonth(year: number, month1indexed: number): Promise<CalendarDay[]> {
  const daysInMonth = new Date(year, month1indexed, 0).getDate();
  const dateKeys = Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(year, month1indexed - 1, i + 1)));

  const [grouped, blockedDates] = await Promise.all([getVisitsGroupedByDate(dateKeys), getBlockedDates()]);
  const blockedByDate = new Map(blockedDates.map((b) => [b.date, b.label]));

  return dateKeys.map((dateKey) => {
    const customers = grouped.get(dateKey) ?? [];
    return {
      date: dateKey,
      count: customers.length,
      blocked: blockedByDate.has(dateKey),
      blockedLabel: blockedByDate.get(dateKey) ?? null,
      customers: customers.map((s) => ({
        id: s.id,
        fullName: s.full_name,
        houseNumber: s.house_number,
        plan: s.plan,
        block: s.block,
      })),
    };
  });
}

export interface SlotLoad {
  slot: number;
  count: number;
}

/** Active-subscriber count per recurring slot (1-14) - what Rebalance operates on. */
export async function getSlotLoads(): Promise<SlotLoad[]> {
  const { rows } = await getPool().query<{ slot: number; count: string }>(
    `select gs as slot, count(s.id) as count
     from generate_series(1, $1::int) as gs
     left join signups s on s.service_slot = gs and s.payment_status = 'active' and s.paused_at is null
     group by gs
     order by gs`,
    [SLOT_COUNT]
  );
  return rows.map((r) => ({ slot: r.slot, count: Number(r.count) }));
}

export interface RebalanceMove {
  signupId: string;
  fullName: string;
  houseNumber: string;
  fromSlot: number;
  toSlot: number;
}

/**
 * Proposes moving customers off slots over `limit` onto slots with room, until balanced
 * or no more room is available. Slot reassignment (not a per-occurrence move) is what
 * keeps each customer's two monthly visits ~14 days apart, since a slot's two visit days
 * are always exactly 14 days apart by construction - moving a customer's slot moves both
 * future visits together. Prefers moving the most recently added customers on an
 * overloaded slot, on the theory that longer-standing customers are more disrupted by a
 * changed service day. Read-only - see applyRebalance for actually committing this.
 */
export async function proposeRebalance(limit: number): Promise<RebalanceMove[]> {
  const loads = await getSlotLoads();
  const overloaded = loads.filter((l) => l.count > limit);
  if (overloaded.length === 0) return [];

  const underloaded = loads
    .filter((l) => l.count < limit)
    .map((l) => ({ slot: l.slot, room: limit - l.count }))
    .sort((a, b) => b.room - a.room);

  const { rows: candidates } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    service_slot: number;
  }>(
    `select id, full_name, house_number, service_slot
     from signups
     where payment_status = 'active' and paused_at is null
       and service_slot = any($1::int[])
     order by service_slot, created_at desc`,
    [overloaded.map((l) => l.slot)]
  );

  const candidatesBySlot = new Map<number, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesBySlot.has(c.service_slot)) candidatesBySlot.set(c.service_slot, []);
    candidatesBySlot.get(c.service_slot)!.push(c);
  }

  const moves: RebalanceMove[] = [];
  let underloadedIndex = 0;
  for (const slot of overloaded) {
    let toShed = slot.count - limit;
    const pool = candidatesBySlot.get(slot.slot) ?? [];
    for (const candidate of pool) {
      if (toShed <= 0) break;
      // Skip past any underloaded slot that's already been filled.
      while (underloadedIndex < underloaded.length && underloaded[underloadedIndex].room <= 0) {
        underloadedIndex++;
      }
      if (underloadedIndex >= underloaded.length) break; // no more room anywhere
      const target = underloaded[underloadedIndex];
      moves.push({
        signupId: candidate.id,
        fullName: candidate.full_name,
        houseNumber: candidate.house_number,
        fromSlot: slot.slot,
        toSlot: target.slot,
      });
      target.room -= 1;
      toShed -= 1;
    }
  }
  return moves;
}

/** Commits a set of moves the owner accepted from proposeRebalance's preview. */
export async function applyRebalance(moves: { signupId: string; toSlot: number }[]): Promise<void> {
  for (const move of moves) {
    await getPool().query(
      "update signups set service_slot = $2, updated_at = now() where id = $1 and payment_status = 'active'",
      [move.signupId, move.toSlot]
    );
  }
}

