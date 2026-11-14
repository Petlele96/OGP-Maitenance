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

-- Unique unguessable link for the public customer-tracking page (/track/[token]) - a
-- random default backfills every existing row when this column is first added, and every
-- new signup gets a fresh one automatically. Never rotated - the same link is sent once,
-- in the welcome WhatsApp message, and stays valid for the life of the customer record.
alter table signups add column if not exists tracking_token uuid not null default gen_random_uuid();
create unique index if not exists signups_tracking_token_idx on signups (tracking_token);

-- Set whenever any WhatsApp button fires from /ops or /owner (reminder, chase, welcome,
-- payment link, tappable number, etc) - powers the owner's "who haven't I spoken to"
-- message centre. Null means never contacted through the app.
alter table signups add column if not exists last_contacted_at timestamptz;

-- Day confirmation: the worker confirms a whole day's route in one tap instead of marking
-- each yard. service_visits keeps one row per completed yard (service_date = the day the work
-- was scheduled) and now also records when it was confirmed and by which crew.
alter table service_visits add column if not exists confirmed_at timestamptz;
alter table service_visits add column if not exists crew text;

-- One row per confirmed day. confirmed_at is the FIRST confirmation and is never overwritten, so
-- reopening and correcting a day later doesn't turn an on-time confirmation into a late one.
-- reopened_at set means the day is open again (outstanding) until it is confirmed again.
create table if not exists day_confirmations (
  service_date date primary key,
  confirmed_at timestamptz not null default now(),
  crew text,
  reopened_at timestamptz,
  updated_at timestamptz not null default now()
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

alter table day_confirmations enable row level security;
drop policy if exists "deny_anonymous_access" on day_confirmations;
create policy "deny_anonymous_access" on day_confirmations for all to anon, authenticated using (false);

-- Customer reviews, collected from one public form (/review) - no account and no per-customer link.
-- The submitted phone is stored in the same normalised 0XXXXXXXXX form as signups.whatsapp_number so the
-- owner interface can match it against the customer list. It is never selected for the public site.
-- A review is never public until the owner approves it. Hidden is a separate flag from status so un-hiding
-- puts a review back exactly where it was - an approved review returns to the site and a never-approved one
-- returns to the pending queue, it is never published by accident. ip_hash is a salted hash (never the raw
-- address) used only to rate-limit the public form.
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved')),
  hidden boolean not null default false,
  reply text,
  replied_at timestamptz,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_ip_idx on reviews (ip_hash, created_at);
create index if not exists reviews_public_idx on reviews (created_at desc) where status = 'approved' and not hidden;
create index if not exists signups_whatsapp_idx on signups (whatsapp_number);

alter table reviews enable row level security;
drop policy if exists "deny_anonymous_access" on reviews;
create policy "deny_anonymous_access" on reviews for all to anon, authenticated using (false);

-- Record a visit: the owner can capture a visit after the fact, by a named worker, with an optional note.
-- The worker's name is stored on the visit itself (the existing crew column) so removing a worker from
-- the list later never changes the history. A note is optional.
alter table service_visits add column if not exists note text;

-- The workers list feeds the "who did the job" picker and nothing else.
create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists workers_name_idx on workers (lower(name));
alter table workers enable row level security;
drop policy if exists "deny_anonymous_access" on workers;
create policy "deny_anonymous_access" on workers for all to anon, authenticated using (false);

-- The client's next service date. It is calculated from the last recorded visit (a suggestion) and the owner
-- can overwrite it by hand at any time - the manual flag only records which of the two it currently is.
-- It decides which day a client appears on (see routing_from below) and when they count as overdue.
alter table signups add column if not exists next_service_date date;
alter table signups add column if not exists next_service_date_manual boolean not null default false;

-- The next service date drives the day lists. routing_from is the first day a client is routed by that date
-- (earlier days keep being rebuilt from the old fixed slot, so history is untouched).
-- The day_confirmations table is no longer written or read. It is kept as it is so no data is lost.
alter table signups add column if not exists routing_from date;

-- How the customer chose to pay at booking: 'pay_now' (card, activates on payment) or 'pay_after_service' (booked, a
-- payment link is sent once their first service is done). It is stored on the customer and drives what the owner dashboard
-- asks for later. Every existing row defaults to 'pay_now' - customers already awaiting payment are marked
-- pay_after_service once, by hand, when this is applied.
alter table signups add column if not exists payment_timing text not null default 'pay_now';
alter table signups drop constraint if exists signups_payment_timing_check;
alter table signups add constraint signups_payment_timing_check check (payment_timing in ('pay_now', 'pay_after_service'));

-- The day of the month the owner's customers are paid. Every month-end due date (the first payday on or after the first
-- service date) is worked out from it, so changing it once re-dates everyone still waiting. Days past the end of a short month fall on that month's last day.
alter table app_settings add column if not exists payday_day integer not null default 25;
alter table app_settings drop constraint if exists app_settings_payday_day_check;
alter table app_settings add constraint app_settings_payday_day_check check (payday_day between 1 and 31);

-- When a customer who chose to pay after their first service wants to pay: on their service day or at month-end.
-- Null for everyone else - and for customers added by hand, who are treated as service day.
alter table signups add column if not exists pay_after_when text;
alter table signups drop constraint if exists signups_pay_after_when_check;
alter table signups add constraint signups_pay_after_when_check check (pay_after_when in ('service_day', 'month_end'));
