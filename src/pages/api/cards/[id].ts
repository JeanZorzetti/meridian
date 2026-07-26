import type { APIRoute } from "astro";
import { sql } from "../../../lib/db.ts";
import { json, pick } from "../../../lib/api.ts";

export const prerender = false;

const FIELDS = ["label", "closing_day", "due_day", "limit_cents", "reserve_cents"];

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "body inválido" }, 400);
  const patch = pick(body, FIELDS);
  if ("label" in patch) {
    const label = String(patch.label ?? "").trim();
    if (!label) return json({ error: "label vazio" }, 400);
    patch.label = label;
  }
  if ("closing_day" in patch) patch.closing_day = Math.trunc(Number(patch.closing_day));
  if ("due_day" in patch) patch.due_day = Math.trunc(Number(patch.due_day));
  if ("limit_cents" in patch) patch.limit_cents = patch.limit_cents == null ? null : Math.trunc(Number(patch.limit_cents));
  if ("reserve_cents" in patch) patch.reserve_cents = Math.trunc(Number(patch.reserve_cents));
  if (Object.keys(patch).length === 0) return json({ error: "nada para atualizar" }, 400);

  const [row] = await sql`update cards set ${sql(patch)}
                          where id = ${id} and user_id = ${user.id} returning id`;
  if (!row) return json({ error: "not found" }, 404);
  return json({ id: row.id });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);

  await sql`delete from cards where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
};
