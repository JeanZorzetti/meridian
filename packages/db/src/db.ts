import postgres from "postgres";
import { streak, type MonthLedger } from "@meridian/core/budget";
import { buildModel, type CategoryModel } from "@meridian/core/categorize";
import { anomalies, forecast, goalProgress, insights, pace, project, type Goal } from "@meridian/core/insights";
import { cutPanel, meatBudgetCents, meatTotals, type MeatCut, type MeatPurchase, type MeatTarget } from "@meridian/core/meat";
import { cardPool, deriveInvoice, invoiceMonth, poolAsSummary, summarizeWithCards, type Card, type CardPool, type Invoice } from "@meridian/core/cards";

// Server-only. `import.meta.env` is Vite's, populated from .env by Astro in
// dev/build; it is undefined when this module is imported from a plain node
// script, and Next has no such object at all. `process.env` covers both of those
// and the standalone Node runtime in production.
//
// Read through a local cast rather than the `ImportMetaEnv` interface: that type
// is declared by whichever app is compiling, so relying on it made this shared
// package compile under Astro and fail under Next. A package two apps import
// cannot depend on either one's ambient types.
function envUrl(): string | undefined {
  const vite = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return vite?.DATABASE_URL ?? process.env.DATABASE_URL;
}

// The client is built on first query, never on import: middleware.ts imports
// this module, and astro build loads middleware while prerendering the
// marketing pages — where there is no DATABASE_URL and no query to run.
// Constructing at import time made `astro build` need a live DB credential.
let client: postgres.Sql | undefined;
function db(): postgres.Sql {
  if (!client) {
    const url = envUrl();
    if (!url) throw new Error("DATABASE_URL não definido (.env)");
    client = postgres(url, { ssl: false, onnotice: () => {} });
  }
  return client;
}

// `sql` is used as a tagged template (sql`select 1`), as a function (sql({...})),
// and for its methods (sql.begin, sql.unsafe, sql.end) — the proxy forwards all
// three to the lazily-built client.
export const sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  apply: (_t, _self, args: unknown[]) => (db() as unknown as CallableFunction)(...args),
  get: (_t, prop) => Reflect.get(db(), prop),
}) as postgres.Sql;

export interface DbBill {
  id: number;
  month: string; // 'YYYY-MM' — deriveInvoice() checks it even though the query below already scopes to one month
  name: string;
  category: string;
  category_source: string; // 'auto' | 'llm' | 'user' — see db/migrations/0001_baseline.sql
  planned_cents: number;
  actual_cents: number | null;
  paid: boolean;
  pay_method: string | null;
  installment_current: number | null;
  installment_total: number | null;
  due_day: number | null;
  recurring: boolean;
  sort_order: number;
  card_id: number | null;
  principal_cents: number | null;
}
export interface DbIncome {
  id: number;
  label: string;
  amount_cents: number;
}
export interface DbSpend {
  id: number;
  spent_on: string; // 'YYYY-MM-DD'
  amount_cents: number;
  category: string;
  category_source: string; // 'auto' | 'llm' | 'user' — see db/migrations/0001_baseline.sql
  note: string | null;
  card_id: number | null;
}
export interface DbCard {
  id: number;
  label: string;
  closing_day: number;
  due_day: number;
  limit_cents: number | null;
  reserve_cents: number;
}
export interface DbInvoiceRow {
  card_id: number;
  total_cents: number | null;
  paid: boolean;
}

export async function getMonthSnapshot(userId: number, month: string) {
  const [incomes, bills, spends] = await Promise.all([
    sql<DbIncome[]>`select id, label, amount_cents from incomes
                    where user_id = ${userId} and month = ${month} order by id`,
    sql<DbBill[]>`select id, month, name, category, category_source, planned_cents, actual_cents,
                         paid, pay_method, installment_current, installment_total,
                         due_day, recurring, sort_order, card_id, principal_cents
                  from bills where user_id = ${userId} and month = ${month}
                  order by sort_order, id`,
    sql<DbSpend[]>`select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, amount_cents,
                          category, category_source, note, card_id
                   from daily_spends where user_id = ${userId} and month = ${month}
                   order by spent_on, id`,
  ]);
  return { incomes: [...incomes], bills: [...bills], spends: [...spends] };
}

/** Every spend the user ever logged — the baseline the anomaly detector needs,
 *  and the source deriveInvoice() buckets by invoiceMonth() (a purchase near
 *  the closing day can belong to a different calendar month than the invoice
 *  it lands in, so a single month's spends aren't enough for that).
 *  `note` carries the only text a spend ever has, so it's what the category
 *  model trains on; anomalies() ignores the extra columns.
 *  ponytail: whole history into memory (<1k rows); aggregate in SQL if it grows. */
export async function getSpendHistory(userId: number) {
  const rows = await sql<DbSpend[]>`
    select id, category, amount_cents, note, card_id,
           to_char(spent_on, 'YYYY-MM-DD') as spent_on
    from daily_spends where user_id = ${userId}`;
  return [...rows];
}

export interface DbWish {
  id: number;
  item: string;
  estimate_cents: number | null;
  when_text: string | null;
  sort_order: number;
  done: boolean;
}

/** A lista de prioridades: fora do mês, como as metas. Pendentes primeiro. */
export async function getWishlist(userId: number) {
  const rows = await sql<DbWish[]>`
    select id, item, estimate_cents, when_text, sort_order, done from wishlist
    where user_id = ${userId} order by done, sort_order, id`;
  return [...rows];
}

/** Carnes do mês: a tabela de cortes, os lançamentos, as metas e as contas feitas
 *  pelo núcleo (meat.ts). O orçamento é a conta «Carnes» do próprio mês. */
export async function getMeat(userId: number, month: string, bills: { name: string; planned_cents: number; actual_cents: number | null }[]) {
  const [cuts, purchases, targets] = await Promise.all([
    sql<MeatCut[]>`select id, category, name, ref_price_cents from meat_cuts
                   where user_id = ${userId} order by category, name`,
    sql<MeatPurchase[]>`select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, cut_id, grams, paid_cents
                        from meat_purchases where user_id = ${userId} and month = ${month}
                        order by spent_on, id`,
    sql<MeatTarget[]>`select cut_id, grams from meat_targets
                      where user_id = ${userId} and month = ${month}`,
  ]);
  const budget_cents = meatBudgetCents(bills);
  return {
    cuts: [...cuts], purchases: [...purchases], targets: [...targets],
    totals: meatTotals([...purchases], budget_cents),
    panel: cutPanel([...cuts], [...purchases], [...targets]),
  };
}

export async function getCards(userId: number) {
  const rows = await sql<DbCard[]>`
    select id, label, closing_day, due_day, limit_cents, reserve_cents
    from cards where user_id = ${userId} order by id`;
  return [...rows];
}

export async function getInvoiceRows(userId: number, month: string) {
  const rows = await sql<DbInvoiceRow[]>`
    select card_id, total_cents, paid from card_invoices
    where user_id = ${userId} and month = ${month}`;
  return [...rows];
}

export interface MonthBaseline {
  month: string;
  income_cents: number;
  committed_cents: number;
}

/** Income and committed totals per month. The streak needs to know what a day in
 *  June was allowed to spend, and a month's sobra is the only way to know — the
 *  spends themselves come from getSpendHistory(). Uses the same bill cost as
 *  summarize(): actual once reconciled, planned until then.
 *  ponytail: two grouped queries over the (user_id, month) indexes, single-user.
 *  Becomes a materialized view the day it hurts. */
export async function getMonthlyBaselines(userId: number): Promise<MonthBaseline[]> {
  const [incomes, committed] = await Promise.all([
    sql<{ month: string; cents: number }[]>`
      select month, coalesce(sum(amount_cents),0)::int as cents
      from incomes where user_id = ${userId} group by month`,
    sql<{ month: string; cents: number }[]>`
      select month, coalesce(sum(coalesce(actual_cents, planned_cents)),0)::int as cents
      from bills where user_id = ${userId} group by month`,
  ]);
  const byMonth = new Map<string, MonthBaseline>();
  const touch = (month: string) => {
    let e = byMonth.get(month);
    if (!e) byMonth.set(month, (e = { month, income_cents: 0, committed_cents: 0 }));
    return e;
  };
  for (const r of incomes) touch(r.month).income_cents = r.cents;
  for (const r of committed) touch(r.month).committed_cents = r.cents;
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** The category model's corpus: every text the user confirmed a category for —
 *  bill names and spend notes alike. Ordered by month so buildModel's dedupe
 *  keeps the most recent correction ('YYYY-MM' sorts chronologically).
 *  ponytail: rebuilt per call — a few hundred rows, sub-millisecond. Cache it
 *  if it ever shows up in a profile. */
export async function getCategoryModel(userId: number): Promise<CategoryModel> {
  const rows = await sql<{ text: string; category: string }[]>`
    select text, category from (
      select name as text, category, month from bills
        where user_id = ${userId} and category_source = 'user'
      union all
      select note as text, category, month from daily_spends
        where user_id = ${userId} and category_source = 'user' and note is not null
    ) corpus order by month`;
  return buildModel([...rows]);
}

/** The full month payload: snapshot + summary + analysis. The one shape both the
 *  SSR page (admin.astro) and the client refetch (/api/month/[month]) hand to
 *  BudgetApp — they must not drift apart. */
export async function getMonthView(userId: number, month: string, today: Date) {
  const [snap, history, baselines, goals, cards, invoiceRows, wishlist] = await Promise.all([
    getMonthSnapshot(userId, month),
    getSpendHistory(userId),
    getMonthlyBaselines(userId),
    // to_char keeps since_month == created_at's month with no redundant column.
    sql<Goal[]>`select id, label, target_cents, by_month,
                       to_char(created_at, 'YYYY-MM') as since_month
                from goals where user_id = ${userId} order by by_month, id`,
    getCards(userId),
    getInvoiceRows(userId, month),
    getWishlist(userId),
  ]);
  const meat = await getMeat(userId, month, snap.bills);
  const invoices: Invoice[] = cards.map((c: Card) =>
    deriveInvoice(c, month, history, snap.bills, invoiceRows.find((r) => r.card_id === c.id) ?? null),
  );
  // Regime de fatura (cards.ts): the invoices due this month are in Contas, and a
  // card purchase only weighs in the month its invoice is due.
  const summary = summarizeWithCards(snap.incomes, snap.bills, snap.spends, invoices, month, today);
  const pool = cards.length ? await getCardPool(userId, month, today, cards, history, snap, summary.remaining_cents) : null;
  // What the hero reads: with cards, "how much still fits on the card"; without, the month's mesada.
  const hero = pool ? poolAsSummary(summary, pool) : summary;
  const projection = project(hero, month, today);
  const anoms = anomalies(history, snap.spends);

  // Every spend under the month it belongs to — feeds the forecast's band and
  // the streak's ledgers alike.
  const spendsByMonth = new Map<string, DbSpend[]>();
  for (const s of history) {
    const m = s.spent_on.slice(0, 7);
    const arr = spendsByMonth.get(m);
    if (arr) arr.push(s);
    else spendsByMonth.set(m, [s]);
  }

  // Totals of *complete* months only: `month` itself is still being lived, and
  // a half-spent month would drag the median down. A month with no rows at all
  // is absent rather than zero — "didn't log" isn't "didn't spend".
  const pastSpendTotals = [...spendsByMonth]
    .filter(([m]) => m < month)
    .map(([, ss]) => ss.reduce((a, s) => a + s.amount_cents, 0));

  // Forecasting a month that isn't the current one would be hindsight, not a
  // projection — project() draws the same line.
  const isCurrent = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}` === month;
  // getMonthlyBaselines() returns every month; forecast() takes past *complete*
  // months only, chronological (see insights.ts). This filter used to live in
  // the SQL as `where month < ${month}` — without it here, billNoise() swallows
  // the month in progress and the band shifts with nobody noticing.
  const fc = isCurrent
    ? forecast(snap.bills, summary.income_cents, pastSpendTotals,
        baselines.filter((b) => b.month < month).map((b) => b.committed_cents), month)
    : [];

  const monthSpent = (m: string) => (spendsByMonth.get(m) ?? []).reduce((a, s) => a + s.amount_cents, 0);
  const ledgers: MonthLedger[] = baselines.map((b) => ({
    month: b.month,
    sobra_cents: b.income_cents - b.committed_cents,
    spends: spendsByMonth.get(b.month) ?? [],
  }));
  // Realized net per month — what actually stayed unspent. goalProgress() keeps
  // only the complete months (before `month`) for a goal's saved total.
  const netByMonth = baselines.map((b) => ({
    month: b.month,
    net_cents: b.income_cents - b.committed_cents - monthSpent(b.month),
  }));

  return {
    month,
    ...snap,
    summary,
    streak: streak(ledgers, today),
    goals: goalProgress([...goals], netByMonth, fc, month),
    cards,
    invoices,
    hero,
    pool,
    meat,
    wishlist,
    insights: {
      projection, anomalies: anoms, forecast: fc, pace: pace(hero, month, today),
      // Unpaid invoices count as open bills, due on their card's day.
      lines: insights(hero, [
        ...snap.bills,
        ...invoices.filter((i) => i.due_cents > 0).map((i) => ({
          planned_cents: i.due_cents, actual_cents: null, paid: i.paid,
          due_day: cards.find((c) => c.id === i.card_id)?.due_day ?? null,
        })),
      ], projection, anoms, fc, month, today, { pool_month: pool?.month }),
    },
  };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** cardPool() for `month`: what next month has free for today's card purchases.
 *  Next month is read from its rows when it has any; otherwise projected the way
 *  rolloverMonth() would build it (same incomes, recurring bills, installments
 *  advanced — forecast()'s month-ahead committed). */
async function getCardPool(
  userId: number, month: string, today: Date, cards: DbCard[], history: DbSpend[],
  snap: Awaited<ReturnType<typeof getMonthSnapshot>>, month_remaining_cents: number,
): Promise<CardPool> {
  const next = nextMonth(month);
  const [nextSnap, nextRows] = await Promise.all([getMonthSnapshot(userId, next), getInvoiceRows(userId, next)]);
  const projected = nextSnap.bills.length === 0 && nextSnap.incomes.length === 0;
  const cost = (b: { planned_cents: number; actual_cents: number | null }) => b.actual_cents ?? b.planned_cents;

  let next_before_cents: number;
  if (projected) {
    const income = snap.incomes.reduce((a, i) => a + i.amount_cents, 0);
    next_before_cents = income - forecast(snap.bills, income, [], [], month, 1)[0].committed_cents;
  } else {
    next_before_cents = nextSnap.incomes.reduce((a, i) => a + i.amount_cents, 0)
      - nextSnap.bills.reduce((a, b) => a + cost(b), 0)
      - nextSnap.spends.filter((s) => s.card_id == null).reduce((a, s) => a + s.amount_cents, 0);
  }
  const next_due_cents = cards
    .map((c) => deriveInvoice(c, next, history, projected ? [] : nextSnap.bills, nextRows.find((r) => r.card_id === c.id) ?? null))
    .reduce((a, i) => a + i.due_cents, 0);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const landing = history.filter((s) => {
    const c = s.card_id == null ? undefined : byId.get(s.card_id);
    return !!c && invoiceMonth(s.spent_on, c.closing_day, c.due_day) === next;
  });
  return cardPool({ month, today, month_remaining_cents, next_month: next, projected, next_before_cents, next_due_cents, landing });
}

/** Generate `to` from `from`: copy incomes + recurring bills, advancing
 *  installments (2/4 -> 3/4) and dropping finished ones. No-op if `to` exists.
 *  Wrapped in a transaction so a mid-loop failure never leaves a partial month
 *  (which the count>0 guard would then refuse to regenerate). */
export async function rolloverMonth(userId: number, from: string, to: string) {
  const [{ count }] = await sql`select count(*)::int as count
                                from bills where user_id = ${userId} and month = ${to}`;
  if (count > 0) return { created: false, reason: "month-exists" as const };

  // ponytail: benign TOCTOU on `to` between check and insert; single-user personal app.
  return await sql.begin(async (sql) => {
    await sql`insert into incomes (user_id, month, label, amount_cents)
              select user_id, ${to}, label, amount_cents
              from incomes where user_id = ${userId} and month = ${from}`;

    const prev = await sql<DbBill[]>`select * from bills
                                     where user_id = ${userId} and month = ${from} and recurring = true`;
    for (const b of prev) {
      let cur = b.installment_current;
      const tot = b.installment_total;
      if (cur != null && tot != null) {
        cur = cur + 1;
        if (cur > tot) continue; // installment complete → don't carry
      }
      await sql`insert into bills ${sql({
        user_id: userId,
        month: to,
        name: b.name,
        category: b.category,
        // A category the user confirmed stays confirmed next month — otherwise
        // every rollover would quietly demote it back to a guess.
        category_source: b.category_source,
        planned_cents: b.planned_cents,
        actual_cents: null,
        paid: false,
        pay_method: b.pay_method,
        installment_current: cur,
        installment_total: tot,
        due_day: b.due_day,
        recurring: b.recurring,
        sort_order: b.sort_order,
        card_id: b.card_id,
        principal_cents: b.principal_cents,
      })}`;
    }
    return { created: true as const };
  });
}
