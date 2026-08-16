export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
export const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Whitelist + drop undefined — for building safe partial UPDATEs. */
export function pick(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/**
 * A 302 with a relative Location.
 *
 * Deliberately not `NextResponse.redirect`, which demands an absolute URL and
 * would have us reconstruct the public origin from request headers. Behind the
 * proxy that origin is not the one Node sees — the same mismatch that forced
 * `security.allowedDomains` into apps/site/astro.config.mjs. A relative Location
 * is valid HTTP, the browser resolves it against the address it actually typed,
 * and there is nothing left to get wrong.
 */
export function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}
