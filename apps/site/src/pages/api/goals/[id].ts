import type { APIRoute } from "astro";
import { sql } from "@meridian/db";
import { json, pick, isMonth } from "../../../lib/api.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "body inválido" }, 400);
  const patch = pick(body, ["label", "target_cents", "by_month"]);
  if ("target_cents" in patch) patch.target_cents = Math.trunc(patch.target_cents as number);
  if ("by_month" in patch && !isMonth(patch.by_month)) return json({ error: "by_month inválido" }, 400);
  if (Object.keys(patch).length === 0) return json({ error: "nada para atualizar" }, 400);

  const [row] = await sql`update goals set ${sql(patch)}
                          where id = ${id} and user_id = ${user.id} returning id`;
  if (!row) return json({ error: "not found" }, 404);
  return json({ id: row.id });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  await sql`delete from goals where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
};
