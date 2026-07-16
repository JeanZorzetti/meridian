import type { APIRoute } from "astro";
import { getCategoryModel, sql } from "../../../lib/db.ts";
import { classifyWithLLM } from "../../../lib/classify-llm.ts";
import { json, isMonth } from "../../../lib/api.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !isMonth(b.month) || !b.name?.trim()) {
    return json({ error: "month e name obrigatórios" }, 400);
  }

  const name = String(b.name).trim();
  // Typing a category by hand is a confirmation; otherwise the cascade guesses
  // (and reports whether the answer traces back to one — see categorize.ts).
  const picked = b.category?.trim();
  const { category, source } = picked
    ? { category: picked, source: "user" as const }
    : await classifyWithLLM(name, await getCategoryModel(user.id));

  const [row] = await sql`insert into bills ${sql({
    user_id: user.id,
    month: b.month,
    name,
    category,
    category_source: source,
    planned_cents: Math.trunc(b.planned_cents ?? 0),
    actual_cents: b.actual_cents == null ? null : Math.trunc(b.actual_cents),
    paid: !!b.paid,
    pay_method: b.pay_method || null,
    installment_current: b.installment_current ?? null,
    installment_total: b.installment_total ?? null,
    due_day: b.due_day ?? null,
    recurring: b.recurring ?? true,
    sort_order: Math.trunc(b.sort_order ?? 0),
  })} returning id`;
  return json({ id: row.id }, 201);
};
