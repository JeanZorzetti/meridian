import { authenticate, createSession, SESSION_COOKIE } from "@meridian/db/auth";
import { redirectTo } from "@/lib/api";
import { appPath } from "@/lib/paths";

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

/**
 * Same-origin check, replacing the one Astro did for us.
 *
 * Astro rejects cross-origin form POSTs itself, using the hostname list baked
 * into `security.allowedDomains` at build time — which is why adding a domain
 * there needs a rebuild. Next has no equivalent for route handlers, so the check
 * is here, comparing the two headers the browser sends. It needs no list: the
 * proxy forwards the public Host, so the app is correct on any domain pointed at
 * it, including a new one, without being rebuilt.
 *
 * A missing Origin is allowed — non-browser clients (curl, the deploy check in
 * docs/HANDOFF.md §5) send none, and they are not what CSRF protects against.
 */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return new Response("cross-origin form post refused", { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isLocked(ip)) return redirectTo(appPath("/login?error=locked"));

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const user = await authenticate(username, password);
  if (!user) {
    recordFail(ip);
    return redirectTo(appPath("/login?error=1"));
  }
  fails.delete(ip); // success clears the counter

  const { token, expires } = await createSession(user.id);
  const res = redirectTo(appPath("/"));
  // Path "/" rather than the base path on purpose: the Astro site shares this
  // host and will read the same cookie to decide between "Entrar" and "Ir para
  // o app". Scoping it to /app would hide the session from the site.
  res.headers.append(
    "set-cookie",
    [
      `${SESSION_COOKIE}=${token}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Expires=${expires.toUTCString()}`,
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return res;
}
