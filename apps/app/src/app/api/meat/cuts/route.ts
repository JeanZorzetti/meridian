import * as m from "@meridian/db/meat";
import { apiUser } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await request.json().catch(() => null);
  const r = await m.createCut(user.id, b);
  return json(r.body, r.status);
}

