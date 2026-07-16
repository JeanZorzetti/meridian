import type { APIRoute } from "astro";
import { sql } from "../../lib/db.ts";
import { json } from "../../lib/api.ts";

export const prerender = false;

// Cross-month history: income / committed / spent per month, last 12 months.
// One roundtrip (three grouped queries in parallel), merged in JS.
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const [inc, bil, spe] = await Promise.all([
    sql`select month, sum(amount_cents)::int as cents from incomes
        where user_id = ${user.id} group by month`,
    sql`select month, sum(coalesce(actual_cents, planned_cents))::int as cents from bills
        where user_id = ${user.id} group by month`,
    sql`select month, sum(amount_cents)::int as cents from daily_spends
        where user_id = ${user.id} group by month`,
  ]);

  const map = new Map<string, { month: string; income_cents: number; committed_cents: number; spent_cents: number }>();
  const at = (m: string) => {
    let r = map.get(m);
    if (!r) { r = { month: m, income_cents: 0, committed_cents: 0, spent_cents: 0 }; map.set(m, r); }
    return r;
  };
  for (const r of inc) at(r.month).income_cents = r.cents;
  for (const r of bil) at(r.month).committed_cents = r.cents;
  for (const r of spe) at(r.month).spent_cents = r.cents;

  const months = [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  return json({ months });
};
