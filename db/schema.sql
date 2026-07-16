-- Meridian /admin — orçamento pessoal. Money is stored as integer cents.
-- Idempotent: safe to re-run.

create table if not exists users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,          -- "salt:hash" scrypt hex
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists incomes (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  month text not null,                  -- 'YYYY-MM'
  label text not null default 'Entrada',
  amount_cents int not null
);

-- Who decided `category`: 'auto' (rules/model guess), 'llm' (Claude guess), or
-- 'user' (a human confirmed this text's category, or it matched one they did).
-- Only 'user' rows train the category model — without this split it would learn
-- from its own mistakes. buildModel() dedupes by text, so a recurring bill
-- carried across months stays one lesson rather than nine.
create table if not exists bills (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  month text not null,                  -- 'YYYY-MM'
  name text not null,
  category text not null default 'Outros',
  category_source text not null default 'auto',
  planned_cents int not null default 0,
  actual_cents int,                     -- null until reconciled
  paid boolean not null default false,
  pay_method text,                      -- 'caixa' | 'cartão' | null
  installment_current int,              -- null if not an installment
  installment_total int,
  due_day int,
  recurring boolean not null default true,   -- carries to next month
  sort_order int not null default 0
);

create table if not exists daily_spends (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  month text not null,                  -- 'YYYY-MM'
  spent_on date not null,
  amount_cents int not null,
  category text not null default 'Outros',
  category_source text not null default 'auto',
  note text
);
-- migrations for DBs created before these columns existed (idempotent)
alter table daily_spends add column if not exists category text not null default 'Outros';
alter table daily_spends add column if not exists category_source text not null default 'auto';
alter table bills        add column if not exists category_source text not null default 'auto';

-- The category model's corpus: user-confirmed rows only.
create index if not exists idx_bills_confirmed on bills(user_id) where category_source = 'user';
create index if not exists idx_spends_confirmed on daily_spends(user_id) where category_source = 'user';

create index if not exists idx_bills_user_month on bills(user_id, month);
create index if not exists idx_incomes_user_month on incomes(user_id, month);
create index if not exists idx_spends_user_month on daily_spends(user_id, month);
create index if not exists idx_sessions_expires on sessions(expires_at);
