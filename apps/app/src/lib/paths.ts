/** Must match `basePath` in next.config.ts. */
export const BASE_PATH = "/app";

/**
 * Prefix an in-app path with the base path.
 *
 * Next applies `basePath` to <Link> and router navigations on its own, but not
 * to `fetch()` and not to a Location header we write by hand. Those two are
 * exactly where the app talks to itself, so they go through here — a bare
 * "/api/month/..." would leave Next entirely and hit the Astro site next door,
 * which answers 404 (or, before the cutover, answers with the *old* app).
 */
export const appPath = (p: string) => `${BASE_PATH}${p}`;
