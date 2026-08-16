import { getCategoryModel, sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { classifyWithLLM } from "@/lib/classify-llm";
import { json, isDate } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !isDate(b.spent_on)) return json({ error: "spent_on (YYYY-MM-DD) obrigatório" }, 400);
  const amount = Math.trunc(b.amount_cents ?? 0);
  if (amount <= 0) return json({ error: "amount_cents deve ser > 0" }, 400);

  // A spend with no note has nothing to classify — the cascade's "Pessoal"
  // fallback would be a guess dressed as a fact, so it stays "Outros".
  const note = b.note?.trim() || null;
  const picked = b.category?.trim();
  const { category, source } = picked
    ? { category: picked, source: "user" as const }
    : note
      ? await classifyWithLLM(note, await getCategoryModel(user.id))
      : { category: "Outros", source: "auto" as const };

  let card_id: number | null = null;
  if (b.card_id != null) {
    const [card] = await sql`select id from cards where id = ${b.card_id} and user_id = ${user.id}`;
    if (!card) return json({ error: "cartão não encontrado" }, 404);
    card_id = card.id;
  }

  const [row] = await sql`insert into daily_spends ${sql({
    user_id: user.id,
    month: b.spent_on.slice(0, 7),
    spent_on: b.spent_on,
    amount_cents: amount,
    category,
    category_source: source,
    note,
    card_id,
  })} returning id`;
  return json({ id: row.id }, 201);
}
