// Self-check for the money path. Run: node --experimental-strip-types src/lib/budget.test.ts
import assert from "node:assert";
import { brlToCents, centsToBRL, daysInMonth, daysRemaining, summarize } from "./budget.ts";

// --- brlToCents ---
assert.equal(brlToCents("R$ 6.328,18"), 632818);
assert.equal(brlToCents(" R$  7.500,00 "), 750000);
assert.equal(brlToCents("R$ 9,99"), 999);
assert.equal(brlToCents("R$ 1.000,00"), 100000);
assert.equal(brlToCents("-R$ 852,39"), -85239);
assert.equal(brlToCents(" R$  -   "), 0);
assert.equal(brlToCents(""), 0);
assert.equal(brlToCents("R$ 39,06"), 3906);

// --- centsToBRL round-trip ---
for (const v of ["R$ 6.328,18", "R$ 7.500,00", "R$ 9,99", "R$ 1.171,82"]) {
  assert.equal(centsToBRL(brlToCents(v)), v, `round-trip ${v}`);
}
assert.equal(centsToBRL(-85239), "-R$ 852,39");
assert.equal(centsToBRL(0), "R$ 0,00");

// --- days ---
assert.equal(daysInMonth("2026-07"), 31);
assert.equal(daysInMonth("2026-02"), 28);
// mid-month: 2026-07-16 -> 31 - 16 + 1 = 16 days left
assert.equal(daysRemaining("2026-07", new Date(2026, 6, 16)), 16);
// future month -> whole month; past month -> 1
assert.equal(daysRemaining("2026-08", new Date(2026, 6, 16)), 31);
assert.equal(daysRemaining("2026-06", new Date(2026, 6, 16)), 1);

// --- summarize: sheet numbers (entrada 7500, comprometido 6328.18) ---
const incomes = [{ amount_cents: 750000 }];
const bills = [
  { planned_cents: 632818, actual_cents: null, paid: false },
];
const s0 = summarize(incomes, bills, [], "2026-07", new Date(2026, 6, 1));
assert.equal(s0.income_cents, 750000);
assert.equal(s0.committed_cents, 632818);
assert.equal(s0.sobra_cents, 117182); // R$ 1.171,82 — matches the sheet
assert.equal(s0.remaining_cents, 117182);
assert.equal(s0.days_remaining, 31);
assert.equal(s0.per_day_cents, Math.floor(117182 / 31)); // 3780 -> R$ 37,80
assert.equal(s0.unpaid_cents, 632818);
assert.equal(s0.paid_cents, 0);

// a daily spend lowers remaining and the live per-day allowance
const s1 = summarize(
  incomes,
  bills,
  [{ amount_cents: 5000, spent_on: "2026-07-01" }],
  "2026-07",
  new Date(2026, 6, 1),
);
assert.equal(s1.spent_cents, 5000);
assert.equal(s1.remaining_cents, 112182);
assert.ok(s1.per_day_cents < s0.per_day_cents, "spend reduces per-day allowance");
assert.equal(s1.burndown.length, 31);
assert.equal(s1.burndown[0].remaining_cents, 112182); // sobra - day1 spend

// paid toggle moves cost from unpaid to paid, committed unchanged
const s2 = summarize(incomes, [{ planned_cents: 632818, actual_cents: null, paid: true }], [], "2026-07", new Date(2026, 6, 1));
assert.equal(s2.committed_cents, 632818);
assert.equal(s2.unpaid_cents, 0);
assert.equal(s2.paid_cents, 632818);

// --- by_category: groups daily spends, sorted desc; missing category → 'Outros' ---
const s3 = summarize(incomes, [], [
  { amount_cents: 3000, spent_on: "2026-07-01", category: "Mercado" },
  { amount_cents: 2000, spent_on: "2026-07-02", category: "Transporte" },
  { amount_cents: 4500, spent_on: "2026-07-03", category: "Mercado" },
  { amount_cents: 1000, spent_on: "2026-07-04" }, // no category → 'Outros'
], "2026-07", new Date(2026, 6, 1));
assert.deepEqual(s3.by_category, [
  { category: "Mercado", cents: 7500 },
  { category: "Transporte", cents: 2000 },
  { category: "Outros", cents: 1000 },
]);
assert.equal(s3.by_category.reduce((a, c) => a + c.cents, 0), s3.spent_cents); // sum matches total
assert.deepEqual(summarize(incomes, [], [], "2026-07", new Date(2026, 6, 1)).by_category, []); // no spends → empty

console.log("budget.test.ts — all assertions passed ✓");
