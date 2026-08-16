import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, isMonth } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
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
}
