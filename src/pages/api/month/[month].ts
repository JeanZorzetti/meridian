import type { APIRoute } from "astro";
import { getMonthView } from "../../../lib/db.ts";
import { json, isMonth } from "../../../lib/api.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const month = params.month;
  if (!isMonth(month)) return json({ error: "invalid month" }, 400);

  return json(await getMonthView(user.id, month, new Date()));
};
