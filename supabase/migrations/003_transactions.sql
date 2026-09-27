-- =============================================================================
-- 003 — Transaction tracking: categories, transactions, category rules
--
-- Run after 001 and 002 in Supabase → SQL Editor. Safe to re-run.
--
-- Merged from the monemapa-main (Bolt) schema, adapted to this app:
--   * owners are public.profiles (this app manages its own users/sessions,
--     so there is no auth.uid() — the server sets user_id on every query)
--   * RLS on with no policies, like the other tables: only the server
--     (service role) can read or write; the browser goes through /v1 APIs
--   * categories are seeded (the design's 16 categories and colours)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- categories: shared reference data
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          text primary key,
  name        text not null,
  type        text not null check (type in ('income', 'expense', 'both')),
  color       text,
  sort_order  int  not null default 0
);

insert into public.categories (id, name, type, color, sort_order) values
  ('salary',        'Salary',            'income',  '#40a02b', 10),
  ('freelance',     'Freelance',         'income',  '#179299', 20),
  ('investments',   'Investments',       'income',  '#209fb5', 30),
  ('refunds',       'Refunds & other',   'income',  '#7287fd', 40),
  ('groceries',     'Groceries',         'expense', '#40a02b', 110),
  ('dining',        'Dining out',        'expense', '#fe640b', 120),
  ('coffee',        'Coffee',            'expense', '#dc8a78', 130),
  ('transport',     'Transport',         'expense', '#1e66f5', 140),
  ('travel',        'Travel',            'expense', '#04a5e5', 150),
  ('shopping',      'Shopping',          'expense', '#ea76cb', 160),
  ('household',     'Household',         'expense', '#df8e1d', 170),
  ('utilities',     'Utilities & bills', 'expense', '#7287fd', 180),
  ('rent',          'Rent',              'expense', '#8839ef', 190),
  ('health',        'Health & fitness',  'expense', '#d20f39', 200),
  ('entertainment', 'Entertainment',     'expense', '#e64553', 210),
  ('other',         'Other',             'both',    '#8c8fa1', 900)
on conflict (id) do update
  set name = excluded.name, type = excluded.type, color = excluded.color, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- transactions: per-user income / expense records
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  type             text not null check (type in ('income', 'expense')),
  amount           numeric(14, 2) not null check (amount > 0),
  description      text not null check (char_length(description) between 1 and 200),
  date             date not null,
  category_id      text references public.categories (id) on delete set null,
  -- How the category was chosen: accepted AI suggestion, saved rule, or the user.
  category_source  text not null default 'user' check (category_source in ('ai', 'user', 'rule')),
  ai_suggested     text references public.categories (id) on delete set null,
  ai_confidence    numeric check (ai_confidence >= 0 and ai_confidence <= 1),
  note             text check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists transactions_user_date_idx    on public.transactions (user_id, date desc);
create index if not exists transactions_user_created_idx on public.transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- category_rules: "always categorize <merchant> as <category>", per user
-- ---------------------------------------------------------------------------
create table if not exists public.category_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  pattern      text not null check (char_length(pattern) between 1 and 80),
  category_id  text not null references public.categories (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, pattern)
);

-- Keep updated_at current (function from migration 001).
drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function public.touch_updated_at();

drop trigger if exists category_rules_touch_updated_at on public.category_rules;
create trigger category_rules_touch_updated_at
  before update on public.category_rules
  for each row execute function public.touch_updated_at();

-- Private to the server, like every other table.
alter table public.categories     enable row level security;
alter table public.transactions   enable row level security;
alter table public.category_rules enable row level security;

notify pgrst, 'reload schema';
