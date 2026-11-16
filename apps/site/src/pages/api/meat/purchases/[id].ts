import type { APIRoute } from "astro";
import * as m from "@meridian/db/meat";
import { json } from "../../../../lib/api.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  const b = await request.json().catch(() => null);
  const r = await m.updatePurchase(user.id, id, b);
  return json(r.body, r.status);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  const r = await m.deletePurchase(user.id, id);
  return json(r.body, r.status);
};
