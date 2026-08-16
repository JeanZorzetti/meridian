import type { APIRoute } from "astro";
import { sql } from "@meridian/db";
import { json, pick } from "../../../lib/api.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
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
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  await sql`delete from incomes where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
};
