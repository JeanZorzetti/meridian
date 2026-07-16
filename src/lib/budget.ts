// Budget math — the single source of truth for the "mesada diária dinâmica"
// method. Money is integer cents everywhere; never a float in the money path.

export interface Income {
  amount_cents: number;
}

export interface Bill {
  planned_cents: number;
  actual_cents: number | null;
  paid: boolean;
}

export interface Spend {
  amount_cents: number;
  spent_on: string; // 'YYYY-MM-DD'
  category?: string;
}

export interface Summary {
  income_cents: number;
  committed_cents: number;
  sobra_cents: number;
  spent_cents: number;
  remaining_cents: number;
  days_in_month: number;
  days_remaining: number;
  per_day_cents: number; // remaining ÷ days left — the live "pode gastar hoje"
  per_day_start_cents: number; // sobra ÷ days-in-month — the month's baseline
  unpaid_cents: number;
  paid_cents: number;
  burndown: { day: number; spent_cents: number; remaining_cents: number }[];
  by_category: { category: string; cents: number }[]; // daily spends grouped, desc
}

/** "R$ 6.328,18" | " R$  -   " | "-R$ 852,39" -> integer cents. */
export function brlToCents(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === "") return 0;
  const negative = s.includes("-");
  const cleaned = s.replace(/[^\d.,]/g, ""); // keep digits, dots, commas
  if (!/\d/.test(cleaned)) return 0;
  const normalized = cleaned.replace(/\./g, "").replace(",", "."); // '.' thousands, ',' decimal
  const value = parseFloat(normalized);
  if (Number.isNaN(value)) return 0;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 632818 -> "R$ 6.328,18". */
export function centsToBRL(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}R$ ${groupThousands(reais)},${dec}`;
}

/** Days in 'YYYY-MM'. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this
}

/** Days from `today` to the end of `month`, inclusive. Clamped to ≥1. */
export function daysRemaining(month: string, today: Date): number {
  const [y, m] = month.split("-").map(Number);
  const total = daysInMonth(month);
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  if (ty < y || (ty === y && tm < m)) return total; // month still ahead → whole month
  if (ty > y || (ty === y && tm > m)) return 1; // month already past → clamp
  return Math.max(1, total - td + 1); // current month
}

export function summarize(
  incomes: Income[],
  bills: Bill[],
  spends: Spend[],
  month: string,
  today: Date,
): Summary {
  const income_cents = incomes.reduce((a, i) => a + i.amount_cents, 0);
  const billCost = (b: Bill) => (b.actual_cents == null ? b.planned_cents : b.actual_cents);
  const committed_cents = bills.reduce((a, b) => a + billCost(b), 0);
  const sobra_cents = income_cents - committed_cents;
  const spent_cents = spends.reduce((a, s) => a + s.amount_cents, 0);
  const remaining_cents = sobra_cents - spent_cents;

  const days_in_month = daysInMonth(month);
  const days_remaining = daysRemaining(month, today);
  const per_day_cents = Math.floor(remaining_cents / days_remaining);
  const per_day_start_cents = Math.floor(sobra_cents / days_in_month);

  const unpaid_cents = bills.reduce((a, b) => a + (b.paid ? 0 : billCost(b)), 0);
  const paid_cents = committed_cents - unpaid_cents;

  const byDay = new Array(days_in_month + 1).fill(0);
  for (const s of spends) {
    const d = parseInt(s.spent_on.slice(8, 10), 10);
    if (d >= 1 && d <= days_in_month) byDay[d] += s.amount_cents;
  }
  const burndown: Summary["burndown"] = [];
  let cum = 0;
  for (let day = 1; day <= days_in_month; day++) {
    cum += byDay[day];
    burndown.push({ day, spent_cents: byDay[day], remaining_cents: sobra_cents - cum });
  }

  const catMap = new Map<string, number>();
  for (const s of spends) {
    const cat = s.category?.trim() || "Outros";
    catMap.set(cat, (catMap.get(cat) ?? 0) + s.amount_cents);
  }
  const by_category = [...catMap.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);

  return {
    income_cents,
    committed_cents,
    sobra_cents,
    spent_cents,
    remaining_cents,
    days_in_month,
    days_remaining,
    per_day_cents,
    per_day_start_cents,
    unpaid_cents,
    paid_cents,
    burndown,
    by_category,
  };
}
