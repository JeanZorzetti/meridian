import postgres from "postgres";
import { streak, summarize, type MonthLedger } from "./budget.ts";
import { buildModel, type CategoryModel } from "./categorize.ts";
import { anomalies, forecast, goalProgress, insights, pace, project, type Goal } from "./insights.ts";

// Server-only. `import.meta.env` is populated from .env in dev/build and is
// undefined when this module is imported from a plain node script; `process.env`
// covers both that and the standalone Node runtime in production.
//
// The client is built on first query, never on import: middleware.ts imports
// this module, and astro build loads middleware while prerendering the
// marketing pages — where there is no DATABASE_URL and no query to run.
// Constructing at import time made `astro build` need a live DB credential.
let client: postgres.Sql | undefined;
function db(): postgres.Sql {
  if (!client) {
    const url = import.meta.env?.DATABASE_URL ?? process.env.DATABASE_URL;
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
  name: string;
  category: string;
  category_source: string; // 'auto' | 'llm' | 'user' — see db/schema.sql
  planned_cents: number;
  actual_cents: number | null;
  paid: boolean;
  pay_method: string | null;
  installment_current: number | null;
  installment_total: number | null;
  due_day: number | null;
  recurring: boolean;
  sort_order: number;
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
  category_source: string; // 'auto' | 'llm' | 'user' — see db/schema.sql
  note: string | null;
}

export async function getMonthSnapshot(userId: number, month: string) {
  const [incomes, bills, spends] = await Promise.all([
    sql<DbIncome[]>`select id, label, amount_cents from incomes
                    where user_id = ${userId} and month = ${month} order by id`,
    sql<DbBill[]>`select id, name, category, category_source, planned_cents, actual_cents,
                         paid, pay_method, installment_current, installment_total,
                         due_day, recurring, sort_order
                  from bills where user_id = ${userId} and month = ${month}
                  order by sort_order, id`,
    sql<DbSpend[]>`select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, amount_cents,
                          category, category_source, note
                   from daily_spends where user_id = ${userId} and month = ${month}
                   order by spent_on, id`,
  ]);
  return { incomes: [...incomes], bills: [...bills], spends: [...spends] };
}

/** Every spend the user ever logged — the baseline the anomaly detector needs.
 *  `note` carries the only text a spend ever has, so it's what the category
 *  model trains on; anomalies() ignores the extra columns.
 *  ponytail: whole history into memory (<1k rows); aggregate in SQL if it grows. */
export async function getSpendHistory(userId: number) {
  const rows = await sql<DbSpend[]>`
    select id, category, amount_cents, note,
           to_char(spent_on, 'YYYY-MM-DD') as spent_on
    from daily_spends where user_id = ${userId}`;
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
  const [snap, history, baselines, goals] = await Promise.all([
    getMonthSnapshot(userId, month),
    getSpendHistory(userId),
    getMonthlyBaselines(userId),
    // to_char keeps since_month == created_at's month with no redundant column.
    sql<Goal[]>`select id, label, target_cents, by_month,
                       to_char(created_at, 'YYYY-MM') as since_month
                from goals where user_id = ${userId} order by by_month, id`,
  ]);
  const summary = summarize(snap.incomes, snap.bills, snap.spends, month, today);
  const projection = project(summary, month, today);
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
    insights: {
      projection, anomalies: anoms, forecast: fc, pace: pace(summary, month, today),
      lines: insights(summary, snap.bills, projection, anoms, fc, month, today),
    },
  };
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
      })}`;
    }
    return { created: true as const };
  });
}
