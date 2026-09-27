create extension if not exists pgcrypto;

-- The business operates in Johannesburg - without this, current_date/now()-based date
-- math (slot scheduling, "this month" revenue/completion/cancellation queries) runs on
-- the server's UTC default, which silently disagrees with the local calendar day for a
-- ~2 hour window every night (South Africa has no DST, so the offset is always +2).
alter database postgres set timezone to 'Africa/Johannesburg';

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
-- Launch offer promotion has ended - no signups ever qualified.
alter table signups drop column if exists launch_offer_eligible;
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

-- Set once the owner has sent the WhatsApp welcome message after signup. Null = not yet welcomed.
alter table signups add column if not exists welcomed_at timestamptz;

-- 'booked' joins the payment_status enum: a Stage 1 signup (name/house/WhatsApp/plan,
-- given a service day) that hasn't been sent a payment link yet, or has one outstanding.
-- Same idempotency reasoning as signups_plan_check above - drop the inline CHECK and
-- validate the enum in Zod instead.
alter table signups drop constraint if exists signups_payment_status_check;

-- Regenerated each time "Send payment link" is tapped on the ops page, so a stale/expired
-- link can always be replaced with a fresh one. Null until the first link is sent.
alter table signups add column if not exists payment_link_token text;
alter table signups add column if not exists payment_link_expires_at timestamptz;
alter table signups add column if not exists payment_link_sent_at timestamptz;

create unique index if not exists signups_payment_link_token_idx
  on signups (payment_link_token) where payment_link_token is not null;

-- One row per "Can't do" tap on the ops page: the visit that was skipped, why, and the
-- working day the operator moved the customer to. Reason validated in Zod, not a DB
-- check, to keep this migration idempotently re-runnable without a guarded DO block.
create table if not exists skipped_visits (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  original_date date not null,
  reason text not null,
  rescheduled_date date not null,
  created_at timestamptz not null default now(),
  unique (signup_id, original_date)
);

create index if not exists skipped_visits_signup_id_idx on skipped_visits (signup_id);
create index if not exists skipped_visits_created_at_idx on skipped_visits (created_at);

-- How the customer actually pays. 'payfast' is the default so every existing web signup
-- backfills correctly without a data migration. EFT/cash customers are billed outside
-- PayFast entirely - the owner records their payments manually (see payments.method below).
alter table signups add column if not exists payment_method text not null default 'payfast'
  check (payment_method in ('payfast', 'eft', 'cash'));

-- Free text: gate code, dogs, where the tap is, anything else the operator needs on site.
-- Editable only from /owner, shown read-only on /ops rows.
alter table signups add column if not exists notes text;

-- Set while a customer is temporarily paused (holiday, dispute, etc): they drop off the
-- schedule and the unpaid-chase list without being cancelled. Null = not paused.
alter table signups add column if not exists paused_at timestamptz;

-- Mirrors signups.payment_method - lets "money in this month" and the payments list
-- distinguish a PayFast ITN from a manually-recorded EFT/cash payment.
alter table payments add column if not exists method text not null default 'payfast'
  check (method in ('payfast', 'eft', 'cash'));

-- Singleton settings row (the boolean PK plus its own value both being 'true' is what
-- forces there to only ever be one row). working_days uses JS's Date.getDay() convention
-- (0=Sunday .. 6=Saturday) so it drops straight into the existing day-of-week math.
create table if not exists app_settings (
  id boolean primary key default true,
  daily_visit_limit integer not null default 7,
  working_days integer[] not null default '{1,2,3,4,5}'
);
insert into app_settings (id, daily_visit_limit, working_days)
  values (true, 7, '{1,2,3,4,5}')
  on conflict (id) do nothing;

-- A specific calendar date the business doesn't work (public holiday, owner's own
-- commitment) - distinct from the weekly working_days pattern above. Blocking a date
-- bulk-moves everyone currently due on it to the next working day (see blockDate in
-- lib/db.ts) - this table is what makes that date show as blocked going forward.
create table if not exists blocked_dates (
  date date primary key,
  label text,
  created_at timestamptz not null default now()
);

-- This app never talks to Supabase's PostgREST API - it connects directly as the table
-- owner (which always bypasses RLS, so none of this affects the app itself). These
-- tables hold full customer PII and payment records, so RLS is enabled with zero
-- policies granted to anon/authenticated: the public Supabase anon key that Vercel's
-- storage integration provisions is then unable to read or write a single row here.
alter table signups enable row level security;
alter table payments enable row level security;
alter table service_visits enable row level security;
alter table skipped_visits enable row level security;

drop policy if exists "deny_anonymous_access" on signups;
create policy "deny_anonymous_access" on signups for all to anon, authenticated using (false);

drop policy if exists "deny_anonymous_access" on payments;
create policy "deny_anonymous_access" on payments for all to anon, authenticated using (false);

drop policy if exists "deny_anonymous_access" on service_visits;
create policy "deny_anonymous_access" on service_visits for all to anon, authenticated using (false);

drop policy if exists "deny_anonymous_access" on skipped_visits;
create policy "deny_anonymous_access" on skipped_visits for all to anon, authenticated using (false);
