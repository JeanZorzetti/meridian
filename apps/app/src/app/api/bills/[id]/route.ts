import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, pick } from "@/lib/api";

const FIELDS = [
  "name", "category", "planned_cents", "actual_cents", "paid", "pay_method",
  "installment_current", "installment_total", "due_day", "recurring", "sort_order",
  "card_id", "principal_cents",
];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "body inválido" }, 400);
  const patch = pick(body, FIELDS);
  if (Object.keys(patch).length === 0) return json({ error: "nada para atualizar" }, 400);

  // A hand-picked category is the training signal the model learns from — record
  // that a human chose it, so it never trains on its own guesses.
  if ("category" in patch) {
    const category = String(patch.category ?? "").trim();
    if (!category) return json({ error: "category vazia" }, 400);
    patch.category = category;
    patch.category_source = "user";
  }
  if ("card_id" in patch && patch.card_id != null) {
    const cardId = Number(patch.card_id);
    const [card] = await sql`select id from cards where id = ${cardId} and user_id = ${user.id}`;
    if (!card) return json({ error: "cartão não encontrado" }, 404);
  }

  const [row] = await sql`update bills set ${sql(patch)}
                          where id = ${id} and user_id = ${user.id} returning id`;
  if (!row) return json({ error: "not found" }, 404);
  return json({ id: row.id });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  await sql`delete from bills where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
}
