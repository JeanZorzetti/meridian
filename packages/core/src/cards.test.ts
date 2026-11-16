// Self-check for the credit layer. Run: node --experimental-strip-types src/lib/cards.test.ts
import assert from "node:assert";
import { cardPool, deriveInvoice, interestOf, invoiceMonth, summarizeWithCards, type Card } from "./cards.ts";
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

// due_cents: o que a fatura soma às Contas além das parcelas já listadas
assert.equal(septInvoice.due_cents, 42000); // 69000 previsto − 27000 de parcela
assert.equal(septWithExtrato.due_cents, 43000); // 70000 do extrato − 27000 de parcela
assert.equal(withReserve.due_cents, 45000); // compras + reserva

// --- summarizeWithCards: sem cartão -> exatamente summarize() ---
const incomes = [{ amount_cents: 750000 }];
const plainBills = [{ planned_cents: 100000, actual_cents: null, paid: false, installment_total: null, principal_cents: null }];
const cashOnly = [{ amount_cents: 5000, spent_on: "2026-09-02", category: "Mercado", card_id: null }];
const sept1 = new Date(2026, 8, 1);
assert.deepEqual(
  summarizeWithCards(incomes, plainBills, cashOnly, [], "2026-09", sept1),
  summarize(incomes, plainBills, cashOnly, "2026-09", sept1),
);

// --- summarizeWithCards: a fatura entra em Contas, a compra no cartão não desconta na hora ---
const septBills = [
  { planned_cents: 632818, actual_cents: null, paid: false, installment_total: null, principal_cents: null }, // conta comum
  { planned_cents: 27000, actual_cents: null, paid: false, installment_total: 4, principal_cents: 100000 }, // parcela do cartão
];
const septSpends = [
  { amount_cents: 9000, spent_on: "2026-09-05", category: "Lazer", card_id: card.id }, // no cartão: vai para a fatura de outubro
  { amount_cents: 1000, spent_on: "2026-09-06", category: "Mercado", card_id: null }, // à vista: desconta hoje
];
const s = summarizeWithCards(incomes, septBills, septSpends, [septWithExtrato], "2026-09", sept1);
// 632818 + 27000 (contas) + 43000 (o que a fatura soma além da parcela) = o extrato inteiro, uma vez só
assert.equal(s.committed_cents, 702818);
assert.equal(s.cash_out_cents, 702818);
assert.equal(s.sobra_cents, 750000 - 702818);
assert.equal(s.spent_cents, 1000); // só o à vista
assert.equal(s.remaining_cents, 750000 - 702818 - 1000);
assert.equal(s.unpaid_cents, 632818 + 27000); // a fatura do exemplo já está paga
assert.equal(s.interest_cents, 2000); // R$20 de juros embutidos nesta parcela
// a divisão por categoria continua mostrando tudo o que foi comprado no mês
assert.deepEqual(s.by_category, [{ category: "Lazer", cents: 9000 }, { category: "Mercado", cents: 1000 }]);
// fatura em aberto entra no «a pagar»
const open = summarizeWithCards(incomes, septBills, [], [septInvoice], "2026-09", sept1);
assert.equal(open.unpaid_cents, 632818 + 27000 + 42000);

// --- cardPool: o que cabe no cartão é o que o mês seguinte tem livre ---
// Setembro, dia 11 (20 dias restantes de 30). Outubro tem R$ 3.000 livres antes das
// faturas; a fatura de outubro já carrega R$ 600: R$ 500 de compras de setembro e
// R$ 100 de reserva.
const sept11 = new Date(2026, 8, 11);
const landing = [
  { amount_cents: 20000, spent_on: "2026-09-02" },
  { amount_cents: 30000, spent_on: "2026-09-10" },
];
const pool = cardPool({
  month: "2026-09", today: sept11, month_remaining_cents: 40000,
  next_month: "2026-10", projected: true,
  next_before_cents: 300000, next_due_cents: 60000, landing,
});
assert.equal(pool.month, "2026-10");
assert.equal(pool.start_cents, 290000); // 3.000 − 100 de reserva; sobra de setembro não soma
assert.equal(pool.used_cents, 50000);
assert.equal(pool.remaining_cents, 240000);
assert.equal(pool.hole_cents, 0);
assert.equal(pool.per_day_cents, 12000); // 2.400 ÷ 20 dias
assert.equal(pool.per_day_start_cents, Math.floor(290000 / 30));
assert.equal(pool.burndown.length, 30);
assert.equal(pool.burndown[0].remaining_cents, 290000);
assert.equal(pool.burndown[1].remaining_cents, 270000);
assert.equal(pool.burndown[29].remaining_cents, 240000);

// mês atual fechando no vermelho: o buraco sai do que cabe no cartão
const holed = cardPool({
  month: "2026-09", today: sept11, month_remaining_cents: -40000,
  next_month: "2026-10", projected: false,
  next_before_cents: 300000, next_due_cents: 60000, landing,
});
assert.equal(holed.hole_cents, 40000);
assert.equal(holed.start_cents, 250000);
assert.equal(holed.remaining_cents, 200000);

// compra de outubro (antes do fechamento) que já está na fatura: conta, mas não entra no gráfico de setembro
const withNext = cardPool({
  month: "2026-09", today: sept11, month_remaining_cents: 0,
  next_month: "2026-10", projected: false,
  next_before_cents: 300000, next_due_cents: 57000,
  landing: [...landing, { amount_cents: 7000, spent_on: "2026-10-02" }],
});
assert.equal(withNext.used_cents, 57000);
assert.equal(withNext.remaining_cents, 243000);
assert.equal(withNext.burndown[29].remaining_cents, 250000);

console.log("cards.test.ts ✓");
