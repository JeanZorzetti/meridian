// Self-check for the analysis. Run: node --experimental-strip-types src/lib/insights.test.ts
import assert from "node:assert";
import { summarize } from "./budget.ts";
import {
  anomalies, forecast, insights, project,
  type ForecastBill, type HistorySpend, type IdSpend,
} from "./insights.ts";
import { categorize } from "./categorize.ts";

// A month with 7500 in, 6328.18 committed -> sobra 1171.82 (the real sheet numbers).
const incomes = [{ amount_cents: 750000 }];
const bills = [{ planned_cents: 632818, actual_cents: null, paid: false, due_day: 20 }];
const sum = (spends: IdSpend[], today: Date) =>
  summarize(incomes, bills, spends, "2026-07", today);

// --- project ---
{
  // day 10, spent 400.00 -> burn 40.00/day, projected 1240.00 over 31 days
  const spends: IdSpend[] = [{ id: 1, spent_on: "2026-07-05", amount_cents: 40000, category: "Pessoal" }];
  const today = new Date(2026, 6, 10);
  const p = project(sum(spends, today), "2026-07", today)!;
  assert.equal(p.days_elapsed, 10);
  assert.equal(p.daily_burn_cents, 4000); // floor(40000 / 10)
  assert.equal(p.projected_spend_cents, 124000); // round(40000 * 31 / 10)
  assert.equal(p.projected_end_cents, 117182 - 124000); // sobra − projected = -6818 (vermelho)
  assert.ok(p.projected_end_cents < 0);
}
{
  // pace that lands in the black: spent 100.00 by day 10 -> projected 310.00 of 1171.82
  const spends: IdSpend[] = [{ id: 1, spent_on: "2026-07-05", amount_cents: 10000, category: "Pessoal" }];
  const today = new Date(2026, 6, 10);
  const p = project(sum(spends, today), "2026-07", today)!;
  assert.equal(p.projected_end_cents, 117182 - 31000);
  assert.ok(p.projected_end_cents > 0);
}
// no pace to extrapolate: future month, past month, or too few days elapsed
assert.equal(project(sum([], new Date(2026, 5, 16)), "2026-07", new Date(2026, 5, 16)), null, "future month");
assert.equal(project(sum([], new Date(2026, 7, 16)), "2026-07", new Date(2026, 7, 16)), null, "past month");
assert.equal(project(sum([], new Date(2026, 6, 2)), "2026-07", new Date(2026, 6, 2)), null, "day 2 is noise");
assert.ok(project(sum([], new Date(2026, 6, 3)), "2026-07", new Date(2026, 6, 3)) !== null, "day 3 projects");

// --- anomalies ---
const hist = (category: string, ...amounts: number[]): HistorySpend[] =>
  amounts.map((amount_cents) => ({ category, amount_cents }));
const spend = (id: number, category: string, amount_cents: number): IdSpend =>
  ({ id, spent_on: "2026-07-12", amount_cents, category });
{
  // Saúde: 5 samples around 6000, median 6000, MAD 500 -> threshold 7500
  const history = hist("Saúde", 5500, 6000, 6000, 6500, 7000);
  const flagged = anomalies(history, [spend(1, "Saúde", 25000), spend(2, "Saúde", 6200)]);
  assert.equal(flagged.length, 1, "only the outlier flags");
  assert.equal(flagged[0].id, 1);
  assert.equal(flagged[0].median_cents, 6000);
  assert.equal(flagged[0].day, 12);
}
{
  // 4 samples is below MIN_SAMPLES -> no pattern, nothing flags however wild
  const history = hist("Saúde", 5500, 6000, 6500, 7000);
  assert.deepEqual(anomalies(history, [spend(1, "Saúde", 999900)]), []);
}
{
  // MAD 0 (identical values) must not flag everything ≠ median; falls back to 2×median
  const history = hist("Assinaturas", 2000, 2000, 2000, 2000, 2000);
  const flagged = anomalies(history, [spend(1, "Assinaturas", 2500), spend(2, "Assinaturas", 5000)]);
  assert.equal(flagged.length, 1, "2500 is within 2×median, 5000 is not");
  assert.equal(flagged[0].id, 2);
}
{
  // an unknown category has no baseline at all
  assert.deepEqual(anomalies(hist("Saúde", 100, 100, 100, 100, 100), [spend(1, "Outros", 999900)]), []);
}

// --- insights ---
{
  const today = new Date(2026, 6, 10);
  const spends: IdSpend[] = [{ id: 1, spent_on: "2026-07-05", amount_cents: 40000, category: "Mercado & Casa" }];
  const s = sum(spends, today);
  const p = project(s, "2026-07", today);
  const lines = insights(s, bills, p, [], [], "2026-07", today);
  assert.ok(lines.some((l) => l.includes("no vermelho") && l.includes("julho")), "projection line");
  assert.ok(lines.some((l) => l.includes("Mercado & Casa") && l.includes("100%")), "top category line");
  assert.ok(lines.some((l) => l.includes("1 conta em aberto soma") && l.includes("vence dia 20")), "unpaid line");
}
{
  // a bill already past its due day is not "a próxima a vencer"
  const today = new Date(2026, 6, 25); // day 25 > due_day 20
  const s = sum([], today);
  const lines = insights(s, bills, null, [], [], "2026-07", today);
  const unpaidLine = lines.find((l) => l.includes("em aberto"))!;
  assert.ok(!unpaidLine.includes("vence dia"), "overdue bill is not announced as upcoming");
}

// --- forecast ---
const fb = (planned_cents: number, recurring = true,
  installment_current: number | null = null, installment_total: number | null = null): ForecastBill =>
  ({ planned_cents, recurring, installment_current, installment_total });

{
  // The whole point: a 2/2 installment is gone next month. A trend model would
  // see July's total and extrapolate upward; the schedule says it drops.
  const f = forecast([fb(500000), fb(72906, true, 2, 2)], 750000, [], [], "2026-07", 3);
  assert.equal(f.length, 3);
  assert.equal(f[0].month, "2026-08");
  assert.equal(f[0].committed_cents, 500000, "the last installment must not carry");
  assert.equal(f[0].ends_cents, 72906);
  assert.equal(f[0].ends_count, 1);
  assert.equal(f[1].ends_count, 0, "it only ends once");
  assert.equal(f[1].committed_cents, 500000);
}
{
  // A long installment survives the horizon; it ends the month after its last.
  const f = forecast([fb(7690, true, 2, 10)], 750000, [], [], "2026-07", 9);
  assert.equal(f[7].month, "2027-03", "months must roll over the year");
  assert.equal(f[7].committed_cents, 7690, "2+8=10 is the last payment, still due");
  assert.equal(f[8].committed_cents, 0, "2+9=11 > 10 — paid off");
  assert.equal(f[8].ends_count, 1);
}
// A one-off bill doesn't carry at all — same rule rolloverMonth applies.
assert.equal(forecast([fb(50000, false)], 750000, [], [], "2026-07", 1)[0].committed_cents, 0);

{
  // Band + health. sobra = 250000; spends p25=150000, median=200000, p75=250000.
  const f = forecast([fb(500000)], 750000, [100000, 150000, 200000, 250000, 300000], [], "2026-07", 1)[0];
  assert.equal(f.sobra_cents, 250000);
  assert.equal(f.spend_low_cents, 150000);
  assert.equal(f.spend_mid_cents, 200000);
  assert.equal(f.spend_high_cents, 250000);
  assert.equal(f.end_mid_cents, 50000);
  assert.equal(f.end_low_cents, 0, "bad case: sobra − p75");
  assert.equal(f.end_high_cents, 100000, "good case: sobra − p25");
  assert.equal(f.health, "verde", "even the bad case holds");
  assert.equal(f.spend_samples, 5);
}
{
  // p75 overshoots the sobra but the median holds -> apertado, not verde.
  const f = forecast([fb(500000)], 750000, [100000, 150000, 200000, 300000, 400000], [], "2026-07", 1)[0];
  assert.equal(f.end_low_cents, -50000);
  assert.equal(f.health, "apertado", "the bad case blows the budget");
}
{
  // The median itself is negative -> vermelho.
  const f = forecast([fb(500000)], 750000, [300000, 350000, 400000], [], "2026-07", 1)[0];
  assert.ok(f.end_mid_cents < 0);
  assert.equal(f.health, "vermelho");
}
{
  // No spend history: don't invent a band, and say the sample is empty rather
  // than quietly promising the whole sobra survives.
  const f = forecast([fb(500000)], 750000, [], [], "2026-07", 1)[0];
  assert.equal(f.spend_samples, 0);
  assert.equal(f.spend_mid_cents, 0);
  assert.equal(f.end_mid_cents, 250000);
  const lines = insights(sum([], new Date(2026, 6, 10)), bills, null, [],
    [f], "2026-07", new Date(2026, 6, 10));
  assert.ok(lines.some((l) => l.includes("sem histórico de gastos")), "must admit it has no basis");
}
{
  // One sample: the band collapses onto it instead of throwing.
  const f = forecast([fb(500000)], 750000, [120000], [], "2026-07", 1)[0];
  assert.equal(f.spend_low_cents, 120000);
  assert.equal(f.spend_high_cents, 120000);
  assert.equal(f.spend_samples, 1);
}
{
  // Bill noise widens the band. Backtesting showed the structural estimate is
  // nearly unbiased but noisy; a band that ignores that reads too precise.
  // committed 5000,5100,5000,5100 -> |deltas| 100,100,100 -> typical move 100.
  // (MAD would say 0 here and claim certainty this series doesn't have.)
  const committed = [500000, 510000, 500000, 510000];
  const f = forecast([fb(500000)], 750000, [200000], committed, "2026-07", 1)[0];
  assert.equal(f.bill_noise_cents, 10000);
  assert.equal(f.end_low_cents, 250000 - 200000 - 10000, "bad case pays the noise");
  assert.equal(f.end_high_cents, 250000 - 200000 + 10000, "good case gets it back");
  assert.equal(f.end_mid_cents, 50000, "the midpoint is untouched — noise is spread, not bias");
}
{
  // Under 3 months there's no drift to measure: no phantom slack.
  const f = forecast([fb(500000)], 750000, [200000], [500000, 510000], "2026-07", 1)[0];
  assert.equal(f.bill_noise_cents, 0);
  assert.equal(f.end_low_cents, 50000);
}
{
  // The forecast lines the UI shows.
  const today = new Date(2026, 6, 10);
  const fcs = forecast([fb(500000), fb(72906, true, 2, 2)], 750000, [100000, 200000, 300000], [], "2026-07", 3);
  const lines = insights(sum([], today), bills, null, [], fcs, "2026-07", today);
  const aug = lines.find((l) => l.startsWith("Agosto"))!;
  assert.ok(aug, "names the month");
  assert.ok(aug.includes("~") && aug.includes("entre"), "hedged: a midpoint and a band, not a promise");
  assert.ok(aug.includes("1 parcela termina"), "reports the money that frees up");
  assert.ok(!lines.some((l) => l.includes("2 parcela termina")), "singular/plural must agree");
}

// --- categorize (the shared copy the API and the scripts both use) ---
assert.equal(categorize("farmacia sao joao"), "Saúde");
assert.equal(categorize("Netflix"), "Assinaturas");
assert.equal(categorize("Aluguel"), "Contas fixas");
assert.equal(categorize("supermercado"), "Mercado & Casa");
assert.equal(categorize("qualquer coisa"), "Pessoal");

console.log("insights: ok");
