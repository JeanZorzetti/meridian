import * as m from "@meridian/db/meat";
import { apiUser } from "@/lib/auth";
import { json } from "@/lib/api";

export async function PUT(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await request.json().catch(() => null);
  const r = await m.setTarget(user.id, b);
  return json(r.body, r.status);
}

