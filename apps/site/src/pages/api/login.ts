import type { APIRoute } from "astro";
import { authenticate, createSession, SESSION_COOKIE } from "@meridian/db/auth";

export const prerender = false;

// ponytail: in-memory failure counter, per-instance. Migrar pra tabela/Redis se
// rodar multi-instância. Map cresce com IPs distintos — desprezível nesta escala.
const MAX_FAILS = 5;
const WINDOW = 15 * 60 * 1000; // 15 min
const fails = new Map<string, { count: number; resetAt: number }>();

function isLocked(ip: string) {
  const rec = fails.get(ip);
  return !!rec && Date.now() < rec.resetAt && rec.count >= MAX_FAILS;
}
function recordFail(ip: string) {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || now > rec.resetAt) fails.set(ip, { count: 1, resetAt: now + WINDOW });
  else rec.count++;
}

export const POST: APIRoute = async ({ request, cookies, redirect, clientAddress }) => {
  let ip = "unknown";
  try { ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress; } catch { /* clientAddress unavailable */ }

  if (isLocked(ip)) return redirect("/login?error=locked");

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const user = await authenticate(username, password);
  if (!user) {
    recordFail(ip);
    return redirect("/login?error=1");
  }
  fails.delete(ip); // success clears the counter

  const { token, expires } = await createSession(user.id);
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    path: "/",
    expires,
  });
  return redirect("/admin");
};
