// Escritas de Carnes e da Lista de prioridades. Fica aqui, e não nas rotas, porque
// as duas apps (Astro e Next) expõem a mesma API e a regra tem de ser uma só.
// Cada função devolve { status, body } — as rotas só repassam.
import { sql } from "./db.ts";

export interface Reply { status: number; body: unknown }
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const bad = (error: string, status = 400): Reply => ({ status, body: { error } });

const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
type Body = Record<string, unknown> | null;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ---- cortes ----
export async function createCut(userId: number, b: Body): Promise<Reply> {
  if (!b || !str(b.name)) return bad("name obrigatório");
  const price = Math.trunc(Number(b.ref_price_cents ?? 0));
  if (!Number.isFinite(price) || price < 0) return bad("ref_price_cents inválido");
  try {
    const [row] = await sql`insert into meat_cuts ${sql({
      user_id: userId, category: str(b.category) || "Outros", name: str(b.name), ref_price_cents: price,
    })} returning id`;
    return ok({ id: row.id }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return bad("já existe um corte com esse nome", 409);
    throw e;
  }
}

export async function updateCut(userId: number, id: number, b: Body): Promise<Reply> {
  if (!b) return bad("body inválido");
  const patch: Record<string, unknown> = {};
  if (str(b.name)) patch.name = str(b.name);
  if (str(b.category)) patch.category = str(b.category);
  if (isInt(b.ref_price_cents) && b.ref_price_cents >= 0) patch.ref_price_cents = Math.trunc(b.ref_price_cents);
  if (Object.keys(patch).length === 0) return bad("nada para atualizar");
  const [row] = await sql`update meat_cuts set ${sql(patch)} where id = ${id} and user_id = ${userId} returning id`;
  return row ? ok({ id: row.id }) : bad("not found", 404);
}

export async function deleteCut(userId: number, id: number): Promise<Reply> {
  try {
    await sql`delete from meat_cuts where id = ${id} and user_id = ${userId}`;
    return ok({ ok: true });
  } catch (e) {
    if ((e as { code?: string }).code === "23503") return bad("o corte tem compras lançadas — apague-as primeiro", 409);
    throw e;
  }
}

// ---- compras ----
export async function createPurchase(userId: number, b: Body): Promise<Reply> {
  if (!b || !isDate(b.spent_on)) return bad("spent_on obrigatório (YYYY-MM-DD)");
  if (!isInt(b.cut_id)) return bad("cut_id obrigatório");
  const grams = Math.trunc(Number(b.grams));
  const paid = Math.trunc(Number(b.paid_cents));
  if (!(grams > 0)) return bad("grams deve ser positivo");
  if (!(paid >= 0)) return bad("paid_cents inválido");
  const [cut] = await sql`select id from meat_cuts where id = ${b.cut_id} and user_id = ${userId}`;
  if (!cut) return bad("corte não encontrado", 404);
  const [row] = await sql`insert into meat_purchases ${sql({
    user_id: userId, month: b.spent_on.slice(0, 7), spent_on: b.spent_on,
    cut_id: b.cut_id, grams, paid_cents: paid,
  })} returning id`;
  return ok({ id: row.id }, 201);
}

export async function updatePurchase(userId: number, id: number, b: Body): Promise<Reply> {
  if (!b) return bad("body inválido");
  const patch: Record<string, unknown> = {};
  if ("spent_on" in b) {
    if (!isDate(b.spent_on)) return bad("spent_on inválido");
    patch.spent_on = b.spent_on;
    patch.month = b.spent_on.slice(0, 7);
  }
  if ("cut_id" in b) {
    if (!isInt(b.cut_id)) return bad("cut_id inválido");
    const [cut] = await sql`select id from meat_cuts where id = ${b.cut_id} and user_id = ${userId}`;
    if (!cut) return bad("corte não encontrado", 404);
    patch.cut_id = b.cut_id;
  }
  if ("grams" in b) {
    const g = Math.trunc(Number(b.grams));
    if (!(g > 0)) return bad("grams deve ser positivo");
    patch.grams = g;
  }
  if ("paid_cents" in b) {
    const p = Math.trunc(Number(b.paid_cents));
    if (!(p >= 0)) return bad("paid_cents inválido");
    patch.paid_cents = p;
  }
  if (Object.keys(patch).length === 0) return bad("nada para atualizar");
  const [row] = await sql`update meat_purchases set ${sql(patch)} where id = ${id} and user_id = ${userId} returning id`;
  return row ? ok({ id: row.id }) : bad("not found", 404);
}

export async function deletePurchase(userId: number, id: number): Promise<Reply> {
  await sql`delete from meat_purchases where id = ${id} and user_id = ${userId}`;
  return ok({ ok: true });
}

// ---- metas do mês (upsert; 0 g apaga a meta) ----
export async function setTarget(userId: number, b: Body): Promise<Reply> {
  if (!b || !isMonth(b.month)) return bad("month obrigatório (YYYY-MM)");
  if (!isInt(b.cut_id)) return bad("cut_id obrigatório");
  const grams = Math.trunc(Number(b.grams));
  if (!(grams >= 0)) return bad("grams inválido");
  const [cut] = await sql`select id from meat_cuts where id = ${b.cut_id} and user_id = ${userId}`;
  if (!cut) return bad("corte não encontrado", 404);
  if (grams === 0) {
    await sql`delete from meat_targets where user_id = ${userId} and month = ${b.month} and cut_id = ${b.cut_id}`;
    return ok({ ok: true });
  }
  await sql`insert into meat_targets (user_id, month, cut_id, grams)
            values (${userId}, ${b.month}, ${b.cut_id}, ${grams})
            on conflict (user_id, month, cut_id) do update set grams = excluded.grams`;
  return ok({ ok: true });
}

// ---- lista de prioridades ----
export async function createWish(userId: number, b: Body): Promise<Reply> {
  if (!b || !str(b.item)) return bad("item obrigatório");
  const est = b.estimate_cents == null ? null : Math.trunc(Number(b.estimate_cents));
  if (est != null && !(est >= 0)) return bad("estimate_cents inválido");
  const [{ next }] = await sql`select coalesce(max(sort_order), 0) + 1 as next from wishlist where user_id = ${userId}`;
  const [row] = await sql`insert into wishlist ${sql({
    user_id: userId, item: str(b.item), estimate_cents: est, when_text: str(b.when_text) || null, sort_order: next,
  })} returning id`;
  return ok({ id: row.id }, 201);
}

export async function updateWish(userId: number, id: number, b: Body): Promise<Reply> {
  if (!b) return bad("body inválido");
  const patch: Record<string, unknown> = {};
  if ("item" in b) { if (!str(b.item)) return bad("item vazio"); patch.item = str(b.item); }
  if ("estimate_cents" in b) {
    const est = b.estimate_cents == null ? null : Math.trunc(Number(b.estimate_cents));
    if (est != null && !(est >= 0)) return bad("estimate_cents inválido");
    patch.estimate_cents = est;
  }
  if ("when_text" in b) patch.when_text = str(b.when_text) || null;
  if ("done" in b) patch.done = !!b.done;
  if (Object.keys(patch).length === 0) return bad("nada para atualizar");
  const [row] = await sql`update wishlist set ${sql(patch)} where id = ${id} and user_id = ${userId} returning id`;
  return row ? ok({ id: row.id }) : bad("not found", 404);
}

export async function deleteWish(userId: number, id: number): Promise<Reply> {
  await sql`delete from wishlist where id = ${id} and user_id = ${userId}`;
  return ok({ ok: true });
}
