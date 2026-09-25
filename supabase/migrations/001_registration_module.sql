-- =============================================================================
-- Registration & OTP sign-in module — database schema
--
-- Run once in Supabase → SQL Editor (or `supabase db push`).
--
-- Identity (emails, confirmations, one-time codes) is owned by Supabase Auth
-- in the `auth` schema. These tables hold what the app itself needs:
--   profiles        one row per fully-registered (email-verified) user
--   registrations   pending sign-ups, polled until the email is verified
--   otp_challenges  per-login attempt tracking (expiry + attempt limit)
--
-- Row Level Security is ON with no policies, so only the server (service role)
-- can read or write. The browser never talks to these tables directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles: the registered user record (requirement: "registration saved in DB")
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null unique check (email = lower(email)),
  full_name      text not null check (char_length(full_name) between 2 and 120),
  status         text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  registered_at  timestamptz not null default now(),
  last_login_at  timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.profiles is 'Users who completed registration (email verified).';

-- ---------------------------------------------------------------------------
-- registrations: a sign-up waiting for its verification link to be clicked
-- ---------------------------------------------------------------------------
create table if not exists public.registrations (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null check (email = lower(email)),
  full_name          text not null check (char_length(full_name) between 2 and 120),
  auth_user_id       uuid not null references auth.users (id) on delete cascade,
  status             text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'EXPIRED')),
  -- SHA-256 of a secret held in an httpOnly cookie by the browser that
  -- registered. Only that browser can poll status and receive the session.
  poll_secret_hash   text not null,
  terms_accepted_at  timestamptz not null,
  last_sent_at       timestamptz not null default now(),
  send_count         integer not null default 1,
  expires_at         timestamptz not null,
  verified_at        timestamptz,
  session_issued_at  timestamptz,
  created_at         timestamptz not null default now()
);

-- At most one open registration per email.
create unique index if not exists registrations_one_pending_per_email
  on public.registrations (email) where status = 'PENDING';

comment on table public.registrations is 'Pending sign-ups awaiting email verification.';

-- ---------------------------------------------------------------------------
-- otp_challenges: one row per "send me a code" request
-- Supabase generates and emails the code; we enforce our own TTL and
-- attempt limit on top so brute force is capped per challenge.
-- ---------------------------------------------------------------------------
create table if not exists public.otp_challenges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  email          text not null check (email = lower(email)),
  attempts_left  integer not null check (attempts_left >= 0),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists otp_challenges_email_created_idx
  on public.otp_challenges (email, created_at desc);

comment on table public.otp_challenges is 'Sign-in code requests with expiry and attempt limits.';

-- ---------------------------------------------------------------------------
-- Atomically spend one attempt on a challenge.
-- Returns the attempts left AFTER spending, or -1 if nothing could be spent
-- (unknown / consumed / revoked / expired / already at zero).
-- Doing this in one UPDATE prevents parallel requests from exceeding the limit.
-- ---------------------------------------------------------------------------
create or replace function public.spend_otp_attempt(p_challenge_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with spent as (
    update public.otp_challenges
       set attempts_left = attempts_left - 1
     where id = p_challenge_id
       and consumed_at is null
       and revoked_at is null
       and expires_at > now()
       and attempts_left > 0
    returning attempts_left
  )
  select coalesce((select attempts_left from spent), -1);
$$;

revoke all on function public.spend_otp_attempt(uuid) from public, anon, authenticated;
grant execute on function public.spend_otp_attempt(uuid) to service_role;

-- Keep profiles.updated_at current.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Lock down: RLS on, no policies → only the service role has access.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.registrations  enable row level security;
alter table public.otp_challenges enable row level security;

-- Make the API (PostgREST) pick up the new tables and function immediately.
notify pgrst, 'reload schema';
