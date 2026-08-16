import type { APIRoute } from "astro";
import { rolloverMonth } from "@meridian/db";
import { json, isMonth } from "../../lib/api.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const b = await request.json().catch(() => null);
  if (!b || !isMonth(b.from) || !isMonth(b.to)) return json({ error: "from/to (YYYY-MM) obrigatórios" }, 400);

  const result = await rolloverMonth(user.id, b.from, b.to);
  return json(result);
};
