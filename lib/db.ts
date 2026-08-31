import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import type { PlanId } from "./plans";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL");
  return neon(url);
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
  created_at: string;
  updated_at: string;
}

export async function createSignup(input: {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  amount: number;
}): Promise<SignupRow> {
  const db = sql();
  const id = randomUUID();
  const rows = (await db`
    insert into signups (id, full_name, house_number, whatsapp_number, plan, amount, payfast_m_payment_id)
    values (${id}, ${input.fullName}, ${input.houseNumber}, ${input.whatsappNumber}, ${input.plan}, ${input.amount}, ${id})
    returning *
  `) as SignupRow[];
  return rows[0];
}

export async function getSignup(id: string): Promise<SignupRow | null> {
  const db = sql();
  const rows = (await db`select * from signups where id = ${id} limit 1`) as SignupRow[];
  return rows[0] ?? null;
}

export async function getSignupByMPaymentId(mPaymentId: string): Promise<SignupRow | null> {
  const db = sql();
  const rows = (await db`select * from signups where payfast_m_payment_id = ${mPaymentId} limit 1`) as SignupRow[];
  return rows[0] ?? null;
}

export async function activateSignup(id: string, subscriptionToken: string | null): Promise<void> {
  const db = sql();
  await db`
    update signups
    set payment_status = 'active',
        start_date = coalesce(start_date, current_date),
        payfast_subscription_token = coalesce(${subscriptionToken}, payfast_subscription_token),
        updated_at = now()
    where id = ${id}
  `;
}

export async function markSignupFailed(id: string): Promise<void> {
  const db = sql();
  await db`
    update signups set payment_status = 'failed', updated_at = now()
    where id = ${id} and payment_status = 'pending'
  `;
}
