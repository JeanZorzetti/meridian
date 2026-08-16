import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, isMonth } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !b.label?.trim()) return json({ error: "label obrigatório" }, 400);
  if (!isMonth(b.by_month)) return json({ error: "by_month obrigatório (YYYY-MM)" }, 400);
  const target_cents = Math.trunc(b.target_cents ?? 0);
  if (target_cents <= 0) return json({ error: "target_cents deve ser positivo" }, 400);

  const [row] = await sql`insert into goals ${sql({
    user_id: user.id,
    label: b.label.trim(),
    target_cents,
    by_month: b.by_month,
  })} returning id`;
  return json({ id: row.id }, 201);
}
