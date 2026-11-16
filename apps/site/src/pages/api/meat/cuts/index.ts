import type { APIRoute } from "astro";
import * as m from "@meridian/db/meat";
import { json } from "../../../../lib/api.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await request.json().catch(() => null);
  const r = await m.createCut(user.id, b);
  return json(r.body, r.status);
};

