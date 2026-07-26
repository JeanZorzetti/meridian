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
  note text,
  -- Nullable on purpose: rows that predate this column have no known creation
  -- time, and "don't know" isn't "the day of the migration". ADD COLUMN with a
  -- DEFAULT would stamp every existing row with the migration's timestamp — the
  -- same lie the rest of this schema avoids. New inserts get now() via the
  -- default set below.
  created_at timestamptz
);
-- migrations for DBs created before these columns existed (idempotent)
alter table daily_spends add column if not exists category text not null default 'Outros';
alter table daily_spends add column if not exists category_source text not null default 'auto';
alter table bills        add column if not exists category_source text not null default 'auto';
-- Two steps, never `add column ... default now()`: add nullable (old rows stay
-- NULL — honestly unknown), then set the default so only future inserts are
-- stamped. Idempotent: the add is a no-op once the column exists, and setting
-- the same default again changes nothing.
alter table daily_spends add column if not exists created_at timestamptz;
alter table daily_spends alter column created_at set default now();

-- Savings goals: a target and a deadline. Progress is the realized sobra of the
-- complete months since created_at (computed in insights.ts), and the ETA reuses
-- the same forecast band the rest of the app hedges with.
create table if not exists goals (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  label text not null,
  target_cents int not null,
  by_month text not null,               -- 'YYYY-MM' — the deadline
  created_at timestamptz not null default now()  -- new table: every row has one
);
create index if not exists idx_goals_user on goals(user_id);

-- The category model's corpus: user-confirmed rows only.
create index if not exists idx_bills_confirmed on bills(user_id) where category_source = 'user';
create index if not exists idx_spends_confirmed on daily_spends(user_id) where category_source = 'user';

create index if not exists idx_bills_user_month on bills(user_id, month);
create index if not exists idx_incomes_user_month on incomes(user_id, month);
create index if not exists idx_spends_user_month on daily_spends(user_id, month);
create index if not exists idx_sessions_expires on sessions(expires_at);

-- Credit cards: the fatura is never a budget line the user types in — it's
-- derived from cards + daily_spends + bills (see deriveInvoice() in
-- src/lib/cards.ts). closing_day/due_day decide which invoice a spend or
-- installment lands in. reserve_cents is a manual monthly allowance for card
-- spend the user chooses not to itemize in daily_spends (the "misto" model).
create table if not exists cards (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  label text not null,
  closing_day int not null,
  due_day int not null,
  limit_cents int,                      -- null = not informed (≠ zero)
  reserve_cents int not null default 0,
  created_at timestamptz not null default now()
);

-- Only what the user actually types when the extrato arrives: the real total
-- and whether it's paid. Everything else about an invoice — itemized spend,
-- installments, reserve, unitemized gap — is arithmetic, never stored twice.
create table if not exists card_invoices (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  card_id int not null references cards(id) on delete cascade,
  month text not null,                  -- 'YYYY-MM' — mês do vencimento
  total_cents int,                      -- null until the extrato arrives
  paid boolean not null default false,
  unique (card_id, month)
);

-- null card_id = caixa/débito/pix à vista. `set null`, not cascade: deleting a
-- card must never delete the spend/bill row it tagged — that would delete a
-- real transaction, not undo a categorization.
alter table daily_spends add column if not exists card_id int references cards(id) on delete set null;
alter table bills        add column if not exists card_id int references cards(id) on delete set null;
-- What actually became cash in a financed purchase (PIX no crédito parcelado,
-- compra parcelada com juros). Null = no known interest for this bill.
-- Interest itself is derived (planned_cents × installment_total −
-- principal_cents), never stored — see interestOf() in src/lib/cards.ts.
alter table bills add column if not exists principal_cents int;

create index if not exists idx_cards_user on cards(user_id);
create index if not exists idx_card_invoices_user_month on card_invoices(user_id, month);
create index if not exists idx_spends_card on daily_spends(card_id) where card_id is not null;
create index if not exists idx_bills_card on bills(card_id) where card_id is not null;
