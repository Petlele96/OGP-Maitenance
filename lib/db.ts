import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { type PlanId, isSubscriberPlan } from "./plans";
import {
  toDateKey,
  visitDaysForSlotInMonth,
  candidateSlotForDate,
  eligibleSlotsForNewSignup,
  addWorkingDays,
  nextWorkingDay,
  nowInJohannesburg,
  MIN_NOTICE_WORKING_DAYS,
  type SkipReason,
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
  payment_status: "pending" | "active" | "failed" | "cancelled";
  payfast_subscription_token: string | null;
  payfast_m_payment_id: string;
  service_slot: number | null;
  cancelled_at: string | null;
  last_payment_failed_at: string | null;
  terms_accepted_at: string;
  block: number | null;
  scheduled_visit_date: string | null;
  welcomed_at: string | null;
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
 * True if this WhatsApp number already has an active monthly or annual subscription.
 * Scoped to subscriptions (not once-off) deliberately - a subscriber booking an extra
 * once-off job, or a past once-off customer booking another one, is normal repeat
 * business, not an accidental double-signup. Preventing two parallel *subscriptions* on
 * the same number is what actually avoids double-billing the same household.
 */
export async function hasActiveSubscription(whatsappNumber: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `select exists(
       select 1 from signups
       where whatsapp_number = $1 and payment_status = 'active' and plan in ('monthly', 'annual')
     ) as exists`,
    [whatsappNumber]
  );
  return rows[0].exists;
}

export async function createSignup(input: {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  amount: number;
  block: number | null;
}): Promise<SignupRow> {
  const id = randomUUID();
  // Once-off bookings don't recur, so there's no bi-monthly slot to assign - they get a
  // scheduled_visit_date instead, set once payment completes (see bookOnceOffVisit).
  const slot = isSubscriberPlan(input.plan)
    ? await pickLeastLoadedSlot(eligibleSlotsForNewSignup(nowInJohannesburg()))
    : null;
  // terms_accepted_at is set unconditionally here, not passed in - the API route only
  // ever calls createSignup after the zod schema has confirmed agreedToTerms === true.
  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id, service_slot, terms_accepted_at, block)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     returning *`,
    [id, input.fullName, input.houseNumber, input.whatsappNumber, input.plan, input.amount, id, slot, input.block]
  );
  return rows[0];
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
  const firstVisitDate = toDateKey(addWorkingDays(nowInJohannesburg(), MIN_NOTICE_WORKING_DAYS));
  await getPool().query(
    `update signups
     set scheduled_visit_date = coalesce(scheduled_visit_date, $2::date),
         updated_at = now()
     where id = $1`,
    [id, firstVisitDate]
  );
}

/** Idempotent via pf_payment_id's unique constraint - safe if PayFast retries an ITN. */
export async function recordPayment(signupId: string, amount: number, pfPaymentId: string | null): Promise<void> {
  await getPool().query(
    `insert into payments (signup_id, amount, pf_payment_id)
     values ($1, $2, $3)
     on conflict (pf_payment_id) do nothing`,
    [signupId, amount, pfPaymentId]
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
  reason: SkipReason;
  rescheduled_date: string;
  created_at: string;
}

/**
 * Records a "Can't do" on today's visit and bumps the customer to the next working day -
 * a one-off extra date on top of their normal recurring slot (getActiveVisitsForDates
 * already treats any skipped_visits.rescheduled_date as a due date), so their regular
 * schedule for future months is untouched. Idempotent per signup/day: tapping "Can't do"
 * again the same day (e.g. to correct the reason) updates the existing row instead of
 * creating a duplicate.
 */
export async function recordSkippedVisit(signupId: string, reason: SkipReason): Promise<SkippedVisitRow> {
  const originalDate = toDateKey(nowInJohannesburg());
  const rescheduledDate = toDateKey(nextWorkingDay(nowInJohannesburg()));
  const { rows } = await getPool().query<SkippedVisitRow>(
    `insert into skipped_visits (signup_id, original_date, reason, rescheduled_date)
     values ($1, $2::date, $3, $4::date)
     on conflict (signup_id, original_date) do update set reason = excluded.reason
     returning id, signup_id, original_date::text, reason, rescheduled_date::text, created_at`,
    [signupId, originalDate, reason, rescheduledDate]
  );
  return rows[0];
}

/** For the ops Today list, to show an already-skipped row as skipped rather than actionable. */
export async function getSkipsForDate(date: string): Promise<Map<string, { reason: SkipReason; rescheduledDate: string }>> {
  const { rows } = await getPool().query<{ signup_id: string; reason: SkipReason; rescheduled_date: string }>(
    "select signup_id, reason, rescheduled_date::text from skipped_visits where original_date = $1",
    [date]
  );
  return new Map(rows.map((r) => [r.signup_id, { reason: r.reason, rescheduledDate: r.rescheduled_date }]));
}

export interface SkippedVisitWithCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  reason: SkipReason;
  originalDate: string;
  rescheduledDate: string;
}

/** For the owner dashboard's "Missed visits" panel. */
export async function getSkippedVisitsThisMonth(): Promise<SkippedVisitWithCustomer[]> {
  const { rows } = await getPool().query<{
    id: string;
    full_name: string;
    house_number: string;
    reason: SkipReason;
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

export async function getRevenueThisMonth(): Promise<{ subscriber: number; onceOff: number; total: number }> {
  const { rows } = await getPool().query<{ subscriber: string; once_off: string }>(
    `select
       coalesce(sum(p.amount) filter (where s.plan in ('monthly', 'annual')), 0) as subscriber,
       coalesce(sum(p.amount) filter (where s.plan = 'once-off'), 0) as once_off
     from payments p
     join signups s on s.id = p.signup_id
     where p.received_at >= ${SAST_MONTH_START_SQL}
       and p.received_at < ${SAST_MONTH_START_SQL} + interval '1 month'`
  );
  const subscriber = Number(rows[0].subscriber);
  const onceOff = Number(rows[0].once_off);
  return { subscriber, onceOff, total: subscriber + onceOff };
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
    "select service_slot from signups where payment_status = 'active' and service_slot is not null"
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

