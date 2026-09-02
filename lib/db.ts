import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { PlanId } from "./plans";
import { SLOT_COUNT, toDateKey, visitDaysForSlot } from "./schedule";

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
  service_slot: number;
  cancelled_at: string | null;
  last_payment_failed_at: string | null;
  terms_accepted_at: string;
  created_at: string;
  updated_at: string;
}

/** The slot with the fewest active customers right now, ties broken by lowest slot number. */
async function pickLeastLoadedSlot(): Promise<number> {
  const { rows } = await getPool().query<{ slot: number; count: string }>(
    `select gs as slot, count(s.id) as count
     from generate_series(1, $1) as gs
     left join signups s on s.service_slot = gs and s.payment_status = 'active'
     group by gs
     order by count(s.id) asc, gs asc
     limit 1`,
    [SLOT_COUNT]
  );
  return rows[0].slot;
}

export async function createSignup(input: {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  amount: number;
}): Promise<SignupRow> {
  const id = randomUUID();
  const slot = await pickLeastLoadedSlot();
  // terms_accepted_at is set unconditionally here, not passed in - the API route only
  // ever calls createSignup after the zod schema has confirmed agreedToTerms === true.
  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id, service_slot, terms_accepted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     returning *`,
    [id, input.fullName, input.houseNumber, input.whatsappNumber, input.plan, input.amount, id, slot]
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
         start_date = coalesce(start_date, current_date),
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

export async function getActiveSignupsForSlots(slots: number[]): Promise<SignupRow[]> {
  if (slots.length === 0) return [];
  const { rows } = await getPool().query<SignupRow>(
    `select * from signups
     where payment_status = 'active' and service_slot = any($1)
     order by house_number`,
    [slots]
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

export async function getActiveCustomerCounts(): Promise<{ monthly: number; annual: number }> {
  const { rows } = await getPool().query<{ plan: PlanId; count: string }>(
    "select plan, count(*) from signups where payment_status = 'active' group by plan"
  );
  const counts = { monthly: 0, annual: 0 };
  for (const row of rows) counts[row.plan] = Number(row.count);
  return counts;
}

export async function getRevenueThisMonth(): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select coalesce(sum(amount), 0) as total
     from payments
     where received_at >= date_trunc('month', current_date)
       and received_at < date_trunc('month', current_date) + interval '1 month'`
  );
  return Number(rows[0].total);
}

export async function getCancellationsThisMonth(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `select count(*) from signups
     where payment_status = 'cancelled'
       and cancelled_at >= date_trunc('month', current_date)
       and cancelled_at < date_trunc('month', current_date) + interval '1 month'`
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
  const today = new Date();
  const todayDay = today.getDate();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const { rows: slotRows } = await getPool().query<{ service_slot: number }>(
    "select service_slot from signups where payment_status = 'active'"
  );

  let scheduled = 0;
  for (const { service_slot } of slotRows) {
    for (const day of visitDaysForSlot(service_slot)) {
      if (day <= todayDay) scheduled += 1;
    }
  }

  const { rows: doneRows } = await getPool().query<{ count: string }>(
    "select count(*) from service_visits where service_date >= $1",
    [toDateKey(monthStart)]
  );

  return { done: Number(doneRows[0].count), scheduled };
}
