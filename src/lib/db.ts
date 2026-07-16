import postgres from "postgres";
import { summarize } from "./budget.ts";
import { buildModel, type CategoryModel } from "./categorize.ts";
import { anomalies, forecast, insights, project } from "./insights.ts";

// Server-only. `import.meta.env` is populated from .env in dev/build and is
// undefined when this module is imported from a plain node script; `process.env`
// covers both that and the standalone Node runtime in production.
const url = import.meta.env?.DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido (.env)");

export const sql = postgres(url, { ssl: false, onnotice: () => {} });

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
    sql<DbSpend[]>`select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, amount_cents, category, note
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
  const [snap, history, committedHistory] = await Promise.all([
    getMonthSnapshot(userId, month),
    getSpendHistory(userId),
    // Past months' bill totals, chronological — the forecast measures how much
    // the committed total drifts from the schedule out of these.
    sql<{ cents: number }[]>`
      select coalesce(sum(coalesce(actual_cents, planned_cents)),0)::int as cents
      from bills where user_id = ${userId} and month < ${month}
      group by month order by month`,
  ]);
  const summary = summarize(snap.incomes, snap.bills, snap.spends, month, today);
  const projection = project(summary, month, today);
  const anoms = anomalies(history, snap.spends);

  // Totals of *complete* months only: `month` itself is still being lived, and
  // a half-spent month would drag the median down. A month with no rows at all
  // is absent rather than zero — "didn't log" isn't "didn't spend".
  const byMonth = new Map<string, number>();
  for (const s of history) {
    const m = s.spent_on.slice(0, 7);
    if (m < month) byMonth.set(m, (byMonth.get(m) ?? 0) + s.amount_cents);
  }
  // Forecasting a month that isn't the current one would be hindsight, not a
  // projection — project() draws the same line.
  const isCurrent = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}` === month;
  const fc = isCurrent
    ? forecast(snap.bills, summary.income_cents, [...byMonth.values()],
        committedHistory.map((r) => r.cents), month)
    : [];

  return {
    month,
    ...snap,
    summary,
    insights: {
      projection, anomalies: anoms, forecast: fc,
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
