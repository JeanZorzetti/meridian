// Run: node --experimental-strip-types src/meat.test.ts
import assert from "node:assert";
import { cutPanel, formatGrams, meatBudgetCents, meatTotals, perKgCents, refPriceCents, toGrams, type MeatCut } from "./meat.ts";

// --- preço por kg ---
assert.equal(perKgCents(2023, 562), 3600); // peito bovino de set/2026: R$ 20,23 por 562 g
assert.equal(perKgCents(2274, 2530), 899); // frango inteiro de out/2026: R$ 22,74 por 2,53 kg
assert.equal(perKgCents(1000, 0), null); // sem peso, nunca Infinity

// --- unidades ---
assert.equal(toGrams(2.53, "kg"), 2530);
assert.equal(toGrams(562, "g"), 562);
assert.equal(formatGrams(562), "562 g");
assert.equal(formatGrams(2530), "2,53 kg");

// --- painel do topo (outubro: uma compra, orçamento R$ 600) ---
const cuts: MeatCut[] = [
  { id: 1, category: "Bovina", name: "Peito bovino", ref_price_cents: 3599 },
  { id: 2, category: "Frango", name: "Frango inteiro", ref_price_cents: 899 },
  { id: 3, category: "Suína", name: "Pernil", ref_price_cents: 1690 },
];
const oct = [{ id: 1, spent_on: "2026-10-13", cut_id: 2, grams: 2530, paid_cents: 2274 }];
assert.deepEqual(meatTotals(oct, 60000),
  { paid_cents: 2274, grams: 2530, avg_per_kg_cents: 899, budget_cents: 60000, balance_cents: 57726 });
assert.deepEqual(meatTotals([], 60000),
  { paid_cents: 0, grams: 0, avg_per_kg_cents: null, budget_cents: 60000, balance_cents: 60000 });

// --- preço de referência: a última compra manda; sem compra, a tabela ---
assert.equal(refPriceCents(cuts[1], oct), 899);
assert.equal(refPriceCents(cuts[0], oct), 3599);
const two = [
  { id: 1, spent_on: "2026-10-02", cut_id: 2, grams: 1000, paid_cents: 1000 },
  { id: 2, spent_on: "2026-10-20", cut_id: 2, grams: 1000, paid_cents: 1200 },
];
assert.equal(refPriceCents(cuts[1], two), 1200);

// --- painel por corte ---
const panel = cutPanel(cuts, oct, [{ cut_id: 2, grams: 4000 }, { cut_id: 3, grams: 1000 }]);
assert.deepEqual(panel.rows.map((r) => [r.name, r.realized_grams, r.target_grams, r.balance_grams, r.budget_cents]), [
  ["Frango inteiro", 2530, 4000, 1470, 2274],
  ["Pernil", 0, 1000, 1000, 0],
]);
assert.deepEqual(panel.total, { realized_grams: 2530, target_grams: 5000, balance_grams: 2470, budget_cents: 2274 });

// --- orçamento do mês vem da conta «Carnes» ---
assert.equal(meatBudgetCents([{ name: "Aluguel", planned_cents: 1, actual_cents: null }, { name: "Carnes", planned_cents: 60000, actual_cents: null }]), 60000);
assert.equal(meatBudgetCents([{ name: "Carne", planned_cents: 50000, actual_cents: 48000 }]), 48000);
assert.equal(meatBudgetCents([{ name: "Carnaval", planned_cents: 5, actual_cents: null }]), 0);
console.log("meat ok");
