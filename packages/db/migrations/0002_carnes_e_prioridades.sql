-- 0002_carnes_e_prioridades — as duas telas que faltavam da planilha CONTAS.
--
-- Carnes: o controle das compras de carne do mês, dentro da conta «Carnes».
--   meat_cuts       a tabela de referência (categoria, corte, preço de referência por kg)
--   meat_purchases  um lançamento: data, corte, quantidade em GRAMAS e valor pago
--   meat_targets    a meta do mês por corte, em gramas
-- Lista de prioridades: a lista de desejos (item, valor estimado, quando).
--
-- Dinheiro em centavos inteiros, peso em gramas inteiras — a planilha mistura kg e g,
-- aqui só existe um.

create table meat_cuts (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  category text not null,
  name text not null,
  ref_price_cents int not null default 0,   -- último preço por kg conhecido
  unique (user_id, name)
);

-- restrict: apagar um corte nunca apaga as compras dele em silêncio.
create table meat_purchases (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  month text not null,                      -- 'YYYY-MM'
  spent_on date not null,
  cut_id int not null references meat_cuts(id) on delete restrict,
  grams int not null check (grams > 0),
  paid_cents int not null check (paid_cents >= 0)
);
create index idx_meat_purchases_user_month on meat_purchases(user_id, month);

create table meat_targets (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  month text not null,
  cut_id int not null references meat_cuts(id) on delete cascade,
  grams int not null check (grams >= 0),
  unique (user_id, month, cut_id)
);

create table wishlist (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  item text not null,
  estimate_cents int,                       -- null: «1 peça por mês» não é número
  when_text text,                           -- texto livre: «maio- crediário»
  sort_order int not null default 0,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_wishlist_user on wishlist(user_id);

-- Semente: a tabela de referência da aba mais nova (preço por kg em centavos).
insert into meat_cuts (user_id, category, name, ref_price_cents)
select u.id, v.category, v.name, v.price
from users u
cross join (values
  ('Bovina', 'Peito bovino', 3599),
  ('Bovina', 'Costela', 2699),
  ('Bovina', 'Língua bovina', 1600),
  ('Bovina', 'Músculo', 2999),
  ('Frango', 'Frango inteiro', 899),
  ('Frango', 'Filé de coxa e sobrecoxa', 998),
  ('Frango', 'Moela', 900),
  ('Frango', 'Fígado', 1050),
  ('Frango', 'Pé', 1000),
  ('Suína', 'Bisteca', 1890),
  ('Suína', 'Pernil', 1690),
  ('Suína', 'Linguiça', 2170),
  ('Suína', 'Costelinha', 1980),
  ('Outros', 'Atum sólido', 1599),
  ('Outros', 'Sardinha em lata', 1098)
) as v(category, name, price);
