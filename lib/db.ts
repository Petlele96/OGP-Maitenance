import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { PlanId } from "./plans";
import { SLOT_COUNT } from "./schedule";

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
  const { rows } = await getPool().query<SignupRow>(
    `insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id, service_slot)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
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
