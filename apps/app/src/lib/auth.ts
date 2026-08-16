import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE } from "@meridian/db/auth";

export type SessionUser = { id: number; username: string };

/**
 * There is deliberately no middleware here.
 *
 * The Astro app guarded /admin and /api/* in `src/middleware.ts`, then every
 * handler re-checked `locals.user` anyway. Next's middleware runs on the edge
 * runtime by default, where the Postgres driver cannot follow — so a session
 * lookup there means either opting the middleware into the Node runtime or
 * downgrading the check to "is a cookie present", which is not authentication.
 *
 * Instead the check lives where the data does: every page calls requireUser()
 * and every route handler calls apiUser(). A new route with neither is a route
 * that fails closed the first time it reads `user.id`, rather than one that
 * silently escaped a matcher pattern.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}

/** For pages: returns the user, or never returns (redirects to the login). */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For route handlers: the user, or null — the caller answers 401 itself. */
export const apiUser = currentUser;
