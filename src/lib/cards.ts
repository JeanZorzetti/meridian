// Credit card math — the fatura is always derived, never entered as a budget
// line. See db/schema.sql for why: `cards`/`card_invoices` only store what a
// human actually knows (the card's dates, and the extrato's real total).
// Pure, no I/O, integer cents — same contract as budget.ts and insights.ts.
// budget.ts stays the untouched baseline; this layer sits beside it and
// db.ts wires the two together, the same way insights.ts wraps Summary
// without insights.ts needing to be summarize()'s concern.

import type { Summary } from "./budget.ts";

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
    used_cents: total_cents ?? expected_cents,
  };
}

/** Corrects two Summary fields for the credit layer, leaving every other
 *  field summarize() already computed untouched:
 *  - cash_out_cents: the liquidity view. A bill charged to a card is already
 *    counted once in committed_cents (competência — it should sting the day
 *    it's due); swapping its cost for the card's invoice total/expected
 *    answers "how much leaves the account this month" without counting that
 *    same real twice.
 *  - interest_cents: the sum of interest embedded in this month's financed
 *    installments — see interestOf().
 *  Called with no cards, both fields collapse to summarize()'s defaults
 *  (cash_out_cents === committed_cents, interest_cents === 0): zero visible
 *  change for a user who never touches this module. */
export function applyCreditCost(summary: Summary, bills: CardBill[], invoices: Invoice[]): Summary {
  const cardBillCost = bills.filter((b) => b.card_id != null).reduce((a, b) => a + billCost(b), 0);
  const invoiceTotal = invoices.reduce((a, i) => a + (i.total_cents ?? i.expected_cents), 0);
  const interest_cents = bills.reduce((a, b) => a + interestOf(b).per_installment_cents, 0);
  return {
    ...summary,
    cash_out_cents: summary.committed_cents - cardBillCost + invoiceTotal,
    interest_cents,
  };
}
