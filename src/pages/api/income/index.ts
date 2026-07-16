import type { APIRoute } from "astro";
import { sql } from "../../../lib/db.ts";
import { json, isMonth } from "../../../lib/api.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !isMonth(b.month)) return json({ error: "month obrigatório" }, 400);

  const [row] = await sql`insert into incomes ${sql({
    user_id: user.id,
    month: b.month,
    label: b.label?.trim() || "Entrada",
    amount_cents: Math.trunc(b.amount_cents ?? 0),
  })} returning id`;
  return json({ id: row.id }, 201);
};
