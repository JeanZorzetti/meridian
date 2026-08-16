import { getMonthView } from "@meridian/db";
import { apiUser } from "@/lib/auth";
import { json, isMonth } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { month } = await params;
  if (!isMonth(month)) return json({ error: "invalid month" }, 400);

  return json(await getMonthView(user.id, month, new Date()));
}
