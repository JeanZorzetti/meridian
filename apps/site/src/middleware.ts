import { defineMiddleware } from "astro:middleware";
import { getSessionUser, SESSION_COOKIE } from "@meridian/db/auth";

// Guards /admin (pages) and /api/* (except /api/login). Marketing routes return
// early with no DB call, so prerendering stays static.
export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;
  const guarded =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    (pathname.startsWith("/api/") && pathname !== "/api/login");

  ctx.locals.user = null;
  if (!guarded) return next();

  const user = await getSessionUser(ctx.cookies.get(SESSION_COOKIE)?.value);
  ctx.locals.user = user;

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return ctx.redirect("/login");
  }
  return next();
});
