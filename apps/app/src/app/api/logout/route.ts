import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@meridian/db/auth";
import { redirectTo } from "@/lib/api";
import { appPath } from "@/lib/paths";

export async function POST() {
  const store = await cookies();
  await destroySession(store.get(SESSION_COOKIE)?.value);
  // Same Path="/" the login wrote with — a delete scoped differently would leave
  // the original cookie in place and log nobody out.
  store.delete({ name: SESSION_COOKIE, path: "/" });
  return redirectTo(appPath("/login"));
}
