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

alter table signups add column if not exists service_slot integer;

create index if not exists signups_service_slot_idx on signups (service_slot);

create table if not exists service_visits (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  service_date date not null,
  completed_at timestamptz not null default now(),
  unique (signup_id, service_date)
);

create index if not exists service_visits_date_idx on service_visits (service_date);

alter table signups add column if not exists cancelled_at timestamptz;
alter table signups add column if not exists last_payment_failed_at timestamptz;
alter table signups add column if not exists terms_accepted_at timestamptz;
alter table signups add column if not exists launch_offer_eligible boolean not null default false;
-- Optional, not compulsory - some streets have no name and some tenants don't know theirs.
-- Values 1-6 (validated in application code, not a DB check, to keep this migration idempotent).
alter table signups add column if not exists block integer;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  amount numeric(10, 2) not null,
  pf_payment_id text unique,
  received_at timestamptz not null default now()
);

create index if not exists payments_signup_id_idx on payments (signup_id);
create index if not exists payments_received_at_idx on payments (received_at);

-- 'once-off' joins 'monthly'/'annual' as a third plan value. ADD CONSTRAINT isn't
-- idempotently re-runnable by this naive semicolon-splitting migration script, so -
-- matching service_slot/block above - the enum is validated in Zod instead of a DB check.
alter table signups drop constraint if exists signups_plan_check;

-- Once-off bookings only: the single date they're booked for. Null for subscribers.
alter table signups add column if not exists scheduled_visit_date date;
