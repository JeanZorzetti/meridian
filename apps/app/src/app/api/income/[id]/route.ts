import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, pick } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "body inválido" }, 400);
  const patch = pick(body, ["label", "amount_cents"]);
  if ("amount_cents" in patch) patch.amount_cents = Math.trunc(patch.amount_cents as number);
  if (Object.keys(patch).length === 0) return json({ error: "nada para atualizar" }, 400);

  const [row] = await sql`update incomes set ${sql(patch)}
                          where id = ${id} and user_id = ${user.id} returning id`;
  if (!row) return json({ error: "not found" }, 404);
  return json({ id: row.id });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  await sql`delete from incomes where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
}
