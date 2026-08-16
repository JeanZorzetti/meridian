import { sql } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, isMonth } from "@/lib/api";

// Upsert keyed by (card_id, month) — the same natural-key POST rollover uses.
// An invoice is identified by which card and which month, never an id the client
// needs to remember; "set the extrato total" and "mark it paid" are the same
// write.
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  const cardId = Number(b?.card_id);
  if (!b || !Number.isInteger(cardId) || !isMonth(b.month)) {
    return json({ error: "card_id e month (YYYY-MM) obrigatórios" }, 400);
  }
  const [card] = await sql`select id from cards where id = ${cardId} and user_id = ${user.id}`;
  if (!card) return json({ error: "cartão não encontrado" }, 404);

  const total_cents = b.total_cents == null ? null : Math.trunc(Number(b.total_cents));
  const paid = !!b.paid;

  const [row] = await sql`
    insert into card_invoices (user_id, card_id, month, total_cents, paid)
    values (${user.id}, ${cardId}, ${b.month}, ${total_cents}, ${paid})
    on conflict (card_id, month) do update
      set total_cents = excluded.total_cents, paid = excluded.paid
    returning id`;
  return json({ id: row.id });
}
