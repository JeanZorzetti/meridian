import { getMonthView } from "@meridian/db";
import { requireUser } from "@/lib/auth";
import BudgetApp from "@/components/BudgetApp";

// Reads cookies through requireUser(), so it is dynamic by construction — there
// is no build-time render of this page to get wrong.
export default async function Page() {
  const user = await requireUser();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const initial = await getMonthView(user.id, month, now);

  return (
    <main className="min-h-screen">
      <BudgetApp initial={initial} username={user.username} />
    </main>
  );
}
