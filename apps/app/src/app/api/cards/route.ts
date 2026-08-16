import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !b.label?.trim()) return json({ error: "label obrigatório" }, 400);
  const closing_day = Math.trunc(Number(b.closing_day));
  const due_day = Math.trunc(Number(b.due_day));
  if (!(closing_day >= 1 && closing_day <= 31)) return json({ error: "closing_day deve ser 1-31" }, 400);
  if (!(due_day >= 1 && due_day <= 31)) return json({ error: "due_day deve ser 1-31" }, 400);

  const [row] = await sql`insert into cards ${sql({
    user_id: user.id,
    label: b.label.trim(),
    closing_day,
    due_day,
    limit_cents: b.limit_cents == null ? null : Math.trunc(Number(b.limit_cents)),
    reserve_cents: Math.trunc(Number(b.reserve_cents ?? 0)),
  })} returning id`;
  return json({ id: row.id }, 201);
}
