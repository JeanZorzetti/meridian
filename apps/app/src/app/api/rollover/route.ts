import { rolloverMonth } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, isMonth } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !isMonth(b.from) || !isMonth(b.to)) return json({ error: "from/to (YYYY-MM) obrigatórios" }, 400);

  const result = await rolloverMonth(user.id, b.from, b.to);
  return json(result);
}
