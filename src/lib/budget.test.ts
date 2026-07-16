// Self-check for the money path. Run: node --experimental-strip-types src/lib/budget.test.ts
import assert from "node:assert";
import { brlToCents, centsToBRL, daysInMonth, daysRemaining, streak, summarize, type MonthLedger } from "./budget.ts";

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

// --- streak: the sheet's month (sobra 1171.82 -> baseline 37.80/day) ---
const led = (month: string, spends: [number, number][], sobra_cents = 117182): MonthLedger => ({
  month,
  sobra_cents,
  spends: spends.map(([day, amount_cents]) => ({
    amount_cents,
    spent_on: `${month}-${String(day).padStart(2, "0")}`,
  })),
});

{
  // days 1-3 well under the allowance; today is the 4th, so the run is 3 days.
  const st = streak([led("2026-07", [[1, 1000], [2, 1000], [3, 1000]])], new Date(2026, 6, 4));
  assert.equal(st.days, 3);
  assert.equal(st.since, "2026-07-01");
  assert.equal(st.through, "2026-07-03", "the run ends yesterday, never today");
}
{
  // blew it yesterday -> nothing to show, and no phantom `since`
  const st = streak([led("2026-07", [[1, 1000], [2, 1000], [3, 50000]])], new Date(2026, 6, 4));
  assert.equal(st.days, 0);
  assert.equal(st.since, null);
  assert.equal(st.through, null);
}
{
  // an overrun on day 3 ends the older run; days 4-5 start a new one
  const st = streak([led("2026-07", [[3, 50000], [4, 1000], [5, 1000]])], new Date(2026, 6, 6));
  assert.equal(st.days, 2);
  assert.equal(st.since, "2026-07-04");
}
{
  // The test that pays for the extra query: June's last 5 days + July's first 2.
  // A streak that reset on the 1st would report 2 and wipe five real days.
  const june = led("2026-06", [[25, 30000], [26, 1000], [27, 1000], [28, 1000], [29, 1000], [30, 1000]]);
  const july = led("2026-07", [[1, 1000], [2, 1000]]);
  const st = streak([july, june], new Date(2026, 6, 3)); // out of order on purpose
  assert.equal(st.days, 7, "5 days of June + 2 of July");
  assert.equal(st.since, "2026-06-26", "stops at June 25th's overrun");
  assert.equal(st.through, "2026-07-02");
}
{
  // A month with no rows is a hole, not a perfect month: the walk stops there.
  const st = streak([led("2026-05", []), led("2026-07", [[1, 1000], [2, 1000]])], new Date(2026, 6, 3));
  assert.equal(st.days, 2, "May can't be reached across a missing June");
  assert.equal(st.since, "2026-07-01");
}
// A day with no spend at all counts as inside — the declared ceiling, pinned by
// a test so nobody "fixes" it without reading why.
assert.equal(streak([led("2026-07", [])], new Date(2026, 6, 5)).days, 4);
// No ledgers at all: no allowance ever existed, so there's no run to report.
assert.deepEqual(streak([], new Date(2026, 6, 5)), { days: 0, since: null, through: null });
{
  // Negative sobra: every allowance is negative, so max(0,·) makes a zero-spend
  // day count and any spend at all break it.
  assert.equal(streak([led("2026-07", [], -50000)], new Date(2026, 6, 5)).days, 4);
  assert.equal(streak([led("2026-07", [[3, 100]], -50000)], new Date(2026, 6, 5)).days, 1);
}
{
  // Today is still open: a blowout right now (day 5) must not touch the run that
  // ended yesterday (day 4). The hero number already tells today's story.
  const st = streak([led("2026-07", [[1, 1000], [2, 1000], [3, 1000], [5, 999900]])], new Date(2026, 6, 5));
  assert.equal(st.days, 4);
  assert.equal(st.through, "2026-07-04");
}

console.log("budget.test.ts — all assertions passed ✓");
