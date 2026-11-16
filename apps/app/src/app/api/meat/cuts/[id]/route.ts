import * as m from "@meridian/db/meat";
import { apiUser } from "@/lib/auth";
import { json } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  const b = await request.json().catch(() => null);
  const r = await m.updateCut(user.id, id, b);
  return json(r.body, r.status);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "invalid id" }, 400);
  const r = await m.deleteCut(user.id, id);
  return json(r.body, r.status);
}
