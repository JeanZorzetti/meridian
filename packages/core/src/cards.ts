// Credit card math — the fatura is always derived, never entered as a budget
// line. See db/migrations/0001_baseline.sql for why: `cards`/`card_invoices` only store what a
// human actually knows (the card's dates, and the extrato's real total).
// Pure, no I/O, integer cents — same contract as budget.ts and insights.ts.
// budget.ts stays the untouched baseline; this layer sits beside it and
// db.ts wires the two together, the same way insights.ts wraps Summary
// without insights.ts needing to be summarize()'s concern.
//
// REGIME DE FATURA (2026-11-15). A casa vive no crédito: a entrada do mês paga
// as faturas, e quase nada sai no débito. Então um gasto no cartão não pesa no
// dia da compra — pesa no mês em que a fatura dele vence (invoiceMonth()).
//   - summarizeWithCards(): o caixa do mês. As faturas que vencem nele entram
//     em Contas; só o gasto à vista desconta na hora.
//   - cardPool(): «quanto ainda cabe no cartão». A compra de hoje cai na fatura
//     do mês seguinte, então o que limita o gasto de hoje é o que o mês seguinte
//     tem livre depois das contas dele.
// Cada compra é contada uma vez só, no mês da fatura. Sem cartão nenhum, as
// duas funções devolvem exatamente o que summarize() devolvia.

import { daysInMonth, daysRemaining, summarize, type Bill, type Income, type Spend, type Summary } from "./budget.ts";

export interface Card {
  id: number;
  label: string;
  closing_day: number;
  due_day: number;
  limit_cents: number | null;
  reserve_cents: number;
}

export interface CardSpend {
  card_id: number | null;
  amount_cents: number;
  spent_on: string; // 'YYYY-MM-DD'
}

export interface CardBill {
  card_id: number | null;
  month: string; // 'YYYY-MM' — the due month, already explicit (mirrors budget.ts's Bill)
  planned_cents: number;
  actual_cents: number | null;
  installment_total: number | null;
  principal_cents: number | null;
}

export interface InvoiceRow {
  card_id: number;
  total_cents: number | null; // what the user typed in from the extrato
  paid: boolean;
}

export interface Invoice {
  card_id: number;
  card_label: string;
  month: string; // 'YYYY-MM' — mês do vencimento
  itemized_cents: number; // daily_spends tagged with this card, bucketed by invoiceMonth()
  installments_cents: number; // bills tagged with this card, due this month
  reserve_cents: number;
  expected_cents: number; // itemized + installments + reserve — before the extrato arrives
  total_cents: number | null; // the real extrato total, once known
  paid: boolean;
  unitemized_cents: number | null; // total − itemized − installments; null until total_cents exists
  limit_cents: number | null;
  used_cents: number; // total_cents ?? expected_cents — the limit gauge's numerator
  // What this invoice adds to the month's Contas beyond the card bills already
  // listed there (used − installments): the purchases, the reserve and whatever
  // the extrato shows that nobody itemized.
  due_cents: number;
}

function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Which invoice (by due month) a purchase on `spent_on` lands in.
 *  A purchase after the closing day rolls into next cycle's invoice; the
 *  invoice itself is due this month if due_day falls after closing_day in the
 *  same calendar month, otherwise the month after. */
export function invoiceMonth(spent_on: string, closing_day: number, due_day: number): string {
  const day = Number(spent_on.slice(8, 10));
  let m = spent_on.slice(0, 7);
  if (day > closing_day) m = addMonths(m, 1);
  return due_day > closing_day ? m : addMonths(m, 1);
}

const billCost = (b: { planned_cents: number; actual_cents: number | null }) =>
  b.actual_cents ?? b.planned_cents;

/** Interest embedded in one bill row of a financed purchase (PIX no crédito
 *  parcelado, compra parcelada com juros). `principal_cents` is what actually
 *  became cash, set once on creation and copied identically to every future
 *  month's row by rolloverMonth() — so this is derivable from any single row,
 *  not just the first. Null principal = no known interest.
 *  ponytail: rateio linear, não tabela de amortização — com 1 a 12 parcelas a
 *  diferença é centavos, e uma tabela sugeriria uma precisão que o PIX no
 *  crédito não informa (o usuário só sabe o valor final das parcelas). */
export function interestOf(
  b: { planned_cents: number; installment_total: number | null; principal_cents: number | null },
): { total_cents: number; per_installment_cents: number } {
  if (b.principal_cents == null) return { total_cents: 0, per_installment_cents: 0 };
  const n = b.installment_total ?? 1;
  const total_cents = b.planned_cents * n - b.principal_cents;
  return { total_cents, per_installment_cents: Math.round(total_cents / n) };
}

/** A card's invoice for `month`, built entirely from rows that already exist.
 *  `spends` should be the user's full spend history (not just this month's) —
 *  a purchase near the closing day can belong to a different calendar month
 *  than the invoice it lands in, so bucketing needs invoiceMonth() over more
 *  than one month of data. `bills` only needs the viewed month's rows: a
 *  bill's `month` already IS its due month, unlike a spend's `spent_on`. */
export function deriveInvoice(
  card: Card,
  month: string,
  spends: CardSpend[],
  bills: CardBill[],
  invoiceRow: InvoiceRow | null,
): Invoice {
  const itemized_cents = spends
    .filter((s) => s.card_id === card.id && invoiceMonth(s.spent_on, card.closing_day, card.due_day) === month)
    .reduce((a, s) => a + s.amount_cents, 0);
  const installments_cents = bills
    .filter((b) => b.card_id === card.id && b.month === month)
    .reduce((a, b) => a + billCost(b), 0);
  const expected_cents = itemized_cents + installments_cents + card.reserve_cents;
  const total_cents = invoiceRow?.total_cents ?? null;
  const used_cents = total_cents ?? expected_cents;

  return {
    card_id: card.id,
    card_label: card.label,
    month,
    itemized_cents,
    installments_cents,
    reserve_cents: card.reserve_cents,
    expected_cents,
    total_cents,
    paid: invoiceRow?.paid ?? false,
    unitemized_cents: total_cents == null ? null : total_cents - itemized_cents - installments_cents,
    limit_cents: card.limit_cents,
    used_cents,
    due_cents: used_cents - installments_cents,
  };
}

type CreditBill = Bill & { installment_total: number | null; principal_cents: number | null };

/** The month's cash, with the cards in it: what is due in `month` and what is
 *  left after paying it.
 *  - Every invoice due in the month joins Contas for its `due_cents`. The card
 *    bills (parcelas, assinaturas marked with a card) are already rows in
 *    `bills`; due_cents is the invoice minus those, so nothing counts twice.
 *  - Only cash spends (no card) reduce the month on the day they happen. A card
 *    purchase is inside the invoice of the month it lands in.
 *  - by_category stays every purchase MADE in the month, card or not: that panel
 *    answers "where did the money go", not "when did it leave the account".
 *  `spends` are the rows dated in `month`; `invoices` are deriveInvoice() for it.
 *  With no cards and no card spends this is summarize(), field for field. */
export function summarizeWithCards(
  incomes: Income[],
  bills: CreditBill[],
  spends: (Spend & { card_id: number | null })[],
  invoices: Invoice[],
  month: string,
  today: Date,
): Summary {
  const lines: Bill[] = invoices.map((i) => ({ planned_cents: i.due_cents, actual_cents: null, paid: i.paid }));
  const cash = spends.filter((s) => s.card_id == null);
  const base = summarize(incomes, [...bills, ...lines], cash, month, today);
  return {
    ...base,
    by_category: summarize([], [], spends, month, today).by_category,
    // The liquidity view and the committed total are now the same number: the
    // invoices are in Contas. The field stays so the payload keeps its shape.
    cash_out_cents: base.committed_cents,
    interest_cents: bills.reduce((a, b) => a + interestOf(b).per_installment_cents, 0),
    card_spent_cents: spends.reduce((a, s) => a + (s.card_id == null ? 0 : s.amount_cents), 0),
  };
}

export interface CardPool {
  month: string; // 'YYYY-MM' — the invoice month this pool belongs to (the month after the one viewed)
  projected: boolean; // true while that month has no rows yet: built from this month's recurring bills
  start_cents: number; // what that month has free for card purchases, before any made from the 1st of the viewed month on
  used_cents: number; // card purchases already landing there, made from the 1st of the viewed month on
  hole_cents: number; // the viewed month's own shortfall (≥ 0), already taken out of start_cents
  remaining_cents: number; // start − used
  per_day_cents: number; // remaining ÷ days left in the viewed month — "cabe no cartão hoje"
  per_day_start_cents: number; // start ÷ days in the viewed month — the baseline
  burndown: { day: number; spent_cents: number; remaining_cents: number }[]; // by day of the viewed month
}

/** How much still fits on the cards while living `month`.
 *  A purchase made today lands on next month's invoice, so the limit is what next
 *  month has left: its entradas − its contas − its à vista (`next_before_cents`),
 *  minus what its invoices already carry (`next_due_cents`).
 *  If the viewed month itself closes short, that hole comes out too — next
 *  month's money is what will cover it. A month that closes with money left adds
 *  nothing: months don't carry a balance into each other anywhere in this app.
 *  `landing` are the card purchases due next month; they only draw the burndown.
 *  ponytail: one calendar month ↔ one invoice month. A purchase made before a
 *  card's closing day lands on THIS month's invoice instead: it shrinks the
 *  month's own sobra (and this pool only if it opens a hole). Six cards closing
 *  between the 3rd and the 11th don't share a cycle to align the days to. */
export function cardPool(a: {
  month: string;
  today: Date;
  month_remaining_cents: number;
  next_month: string;
  projected: boolean;
  next_before_cents: number;
  next_due_cents: number;
  landing: { amount_cents: number; spent_on: string }[];
}): CardPool {
  const first = `${a.month}-01`;
  const n = daysInMonth(a.month);
  const hole_cents = Math.max(0, -a.month_remaining_cents);
  const inWindow = a.landing.filter((s) => s.spent_on >= first);
  const used_cents = inWindow.reduce((acc, s) => acc + s.amount_cents, 0);
  // Whatever the invoices carry that isn't one of those purchases — a reserve, an
  // extrato's unitemized part, a purchase from before the window — is taken off
  // the start: it was never up for spending this month.
  const start_cents = a.next_before_cents - hole_cents - (a.next_due_cents - used_cents);
  const remaining_cents = start_cents - used_cents;

  const byDay = new Array(n + 1).fill(0);
  for (const s of inWindow) {
    if (s.spent_on.slice(0, 7) !== a.month) continue; // made after the viewed month: counted, not drawn
    const d = parseInt(s.spent_on.slice(8, 10), 10);
    if (d >= 1 && d <= n) byDay[d] += s.amount_cents;
  }
  const burndown: CardPool["burndown"] = [];
  let cum = 0;
  for (let day = 1; day <= n; day++) {
    cum += byDay[day];
    burndown.push({ day, spent_cents: byDay[day], remaining_cents: start_cents - cum });
  }

  return {
    month: a.next_month,
    projected: a.projected,
    start_cents,
    used_cents,
    hole_cents,
    remaining_cents,
    per_day_cents: Math.floor(remaining_cents / daysRemaining(a.month, a.today)),
    per_day_start_cents: Math.floor(start_cents / n),
    burndown,
  };
}

/** The hero's Summary while the cards set the pace: the same fields the hero,
 *  project(), pace() and insights() already read, filled from the pool. Every
 *  other field (income, committed, by_category, interest…) stays the month's. */
export function poolAsSummary(summary: Summary, pool: CardPool): Summary {
  return {
    ...summary,
    sobra_cents: pool.start_cents,
    spent_cents: pool.burndown.reduce((a, d) => a + d.spent_cents, 0),
    remaining_cents: pool.remaining_cents,
    per_day_cents: pool.per_day_cents,
    per_day_start_cents: pool.per_day_start_cents,
    burndown: pool.burndown,
  };
}
