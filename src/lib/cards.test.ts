// Self-check for the credit layer. Run: node --experimental-strip-types src/lib/cards.test.ts
import assert from "node:assert";
import { applyCreditCost, deriveInvoice, interestOf, invoiceMonth, type Card } from "./cards.ts";
import { summarize } from "./budget.ts";

// --- invoiceMonth ---
// closing 28, due 10: due_day < closing_day -> invoice is due the month AFTER it closes.
assert.equal(invoiceMonth("2026-08-12", 28, 10), "2026-09"); // before closing -> closes 28/08, vence 10/09
assert.equal(invoiceMonth("2026-08-29", 28, 10), "2026-10"); // after closing -> next cycle, closes 28/09, vence 10/10
assert.equal(invoiceMonth("2026-12-29", 28, 10), "2027-02"); // year rollover: closes 28/01/27, vence 10/02/27
// closing 5, due 12: due_day > closing_day -> invoice due the same month it closes.
assert.equal(invoiceMonth("2026-08-03", 5, 12), "2026-08");
assert.equal(invoiceMonth("2026-08-20", 5, 12), "2026-09");

// --- interestOf ---
// PIX de R$1.000 em 4x de R$270 -> R$80 de juros, R$20 embutidos por parcela.
assert.deepEqual(interestOf({ planned_cents: 27000, installment_total: 4, principal_cents: 100000 }),
  { total_cents: 8000, per_installment_cents: 2000 });
// sem parcelamento (1x)
assert.deepEqual(interestOf({ planned_cents: 108000, installment_total: null, principal_cents: 100000 }),
  { total_cents: 8000, per_installment_cents: 8000 });
// sem principal conhecido -> zero, nunca NaN
assert.deepEqual(interestOf({ planned_cents: 27000, installment_total: 4, principal_cents: null }),
  { total_cents: 0, per_installment_cents: 0 });

// --- deriveInvoice ---
const card: Card = { id: 1, label: "Nubank", closing_day: 28, due_day: 10, limit_cents: 300000, reserve_cents: 0 };
const otherCard: Card = { id: 2, label: "Outro", closing_day: 28, due_day: 10, limit_cents: null, reserve_cents: 0 };

const spends = [
  { card_id: card.id, amount_cents: 42000, spent_on: "2026-08-12" }, // -> setembro (antes do fechamento)
  { card_id: card.id, amount_cents: 5000, spent_on: "2026-08-29" }, // -> outubro (depois do fechamento)
  { card_id: otherCard.id, amount_cents: 99999, spent_on: "2026-08-12" }, // outro cartão, não deve entrar
  { card_id: null, amount_cents: 5000, spent_on: "2026-08-05" }, // sem cartão, não deve entrar
];
const bills = [
  { card_id: card.id, month: "2026-09", planned_cents: 27000, actual_cents: null, installment_total: 4, principal_cents: 100000 },
  { card_id: otherCard.id, month: "2026-09", planned_cents: 5000, actual_cents: null, installment_total: null, principal_cents: null },
];

// fatura de setembro: itemizado (42000, a compra de outubro fica de fora) + parcela (27000)
const septInvoice = deriveInvoice(card, "2026-09", spends, bills, null);
assert.equal(septInvoice.itemized_cents, 42000);
assert.equal(septInvoice.installments_cents, 27000);
assert.equal(septInvoice.expected_cents, 69000);
assert.equal(septInvoice.total_cents, null);
assert.equal(septInvoice.unitemized_cents, null); // sem extrato ainda -> não afirma nada
assert.equal(septInvoice.used_cents, 69000); // sem extrato -> usa o previsto

// fatura de outubro: só a compra do dia 29/08
const octInvoice = deriveInvoice(card, "2026-10", spends, [], null);
assert.equal(octInvoice.itemized_cents, 5000);
assert.equal(octInvoice.installments_cents, 0);

// extrato chega: R$700 reais, R$1 não itemizado
const septWithExtrato = deriveInvoice(card, "2026-09", spends, bills, { card_id: 1, total_cents: 70000, paid: true });
assert.equal(septWithExtrato.unitemized_cents, 1000);
assert.equal(septWithExtrato.used_cents, 70000); // extrato real vence o previsto
assert.equal(septWithExtrato.paid, true);

// reserva soma no previsto e no não-itemizado esperado
const reserveCard: Card = { ...card, reserve_cents: 3000 };
const withReserve = deriveInvoice(reserveCard, "2026-09", spends, bills, null);
assert.equal(withReserve.expected_cents, 72000); // 42000 + 27000 + 3000

// --- applyCreditCost: no cards -> zero visible change ---
const incomes = [{ amount_cents: 750000 }];
const plainBills = [{ planned_cents: 100000, actual_cents: null, paid: false }];
const baseline = summarize(incomes, plainBills, [], "2026-09", new Date(2026, 8, 1));
assert.equal(baseline.cash_out_cents, baseline.committed_cents);
assert.equal(baseline.interest_cents, 0);
const unchanged = applyCreditCost(baseline, [], []);
assert.deepEqual(unchanged, baseline);

// --- applyCreditCost: a real scenario, no double counting ---
// committed_cents already counts the card bill (27000) at competência. cash_out
// must swap that 27000 for the invoice's total (70000, extrato real) exactly
// once — never both.
const cardBillsForSummary = [
  { planned_cents: 632818, actual_cents: null, paid: false }, // conta comum, sem cartão
  { planned_cents: 27000, actual_cents: null, paid: false, card_id: 1 }, // parcela do cartão
];
const s = summarize(incomes, cardBillsForSummary, [], "2026-09", new Date(2026, 8, 1));
assert.equal(s.committed_cents, 659818); // 632818 + 27000 — a mesada continua em competência
const withCard = applyCreditCost(
  s,
  [{ card_id: 1, month: "2026-09", planned_cents: 27000, actual_cents: null, installment_total: 4, principal_cents: 100000 }],
  [septWithExtrato],
);
// 659818 - 27000 (a parcela, já contada) + 70000 (o extrato real da fatura)
assert.equal(withCard.cash_out_cents, 702818);
assert.equal(withCard.interest_cents, 2000); // R$20 de juros embutidos nesta parcela

console.log("cards.test.ts ✓");
