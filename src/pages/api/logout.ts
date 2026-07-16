import type { APIRoute } from "astro";
import { destroySession, SESSION_COOKIE } from "../../lib/auth.ts";

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await destroySession(cookies.get(SESSION_COOKIE)?.value);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/login");
};
