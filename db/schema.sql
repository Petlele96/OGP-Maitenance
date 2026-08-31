create extension if not exists pgcrypto;

create table if not exists signups (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  house_number text not null,
  whatsapp_number text not null,
  plan text not null check (plan in ('monthly', 'annual')),
  amount numeric(10, 2) not null,
  start_date date,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'active', 'failed', 'cancelled')),
  payfast_subscription_token text,
  payfast_m_payment_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signups_payment_status_idx on signups (payment_status);
