// Month analysis: end-of-month projection, out-of-pattern spend detection, and
// the plain-text lines the UI shows. Pure — no I/O, integer cents throughout.
// Every number here is arithmetic over the user's own rows; nothing is generated.

import { centsToBRL, type Bill, type Spend, type Summary } from "./budget.ts";

export interface InsightBill extends Bill {
  due_day?: number | null;
}
export interface IdSpend extends Spend {
  id: number;
}
export interface HistorySpend {
  category: string;
  amount_cents: number;
}

export interface Projection {
  days_elapsed: number;
  daily_burn_cents: number; // mean over elapsed days, zero-spend days included
  projected_spend_cents: number; // total spend by month end at this pace
  projected_end_cents: number; // sobra − projected spend; negative = vermelho
}

/** Extrapolate the month's end from the pace so far. Null when there's nothing
 *  to extrapolate: a month that isn't the current one, or fewer than 3 days in.
 *  ponytail: linear extrapolation of the mean daily burn — no weekday/payday
 *  seasonality. Exponential smoothing if the history ever gets long enough. */
export function project(summary: Summary, month: string, today: Date): Projection | null {
  const [y, m] = month.split("-").map(Number);
  if (today.getFullYear() !== y || today.getMonth() + 1 !== m) return null;

  const days_elapsed = today.getDate();
  if (days_elapsed < 3) return null; // 1-2 days of data is noise, not a pace

  const daily_burn_cents = Math.floor(summary.spent_cents / days_elapsed);
  const projected_spend_cents = Math.round((summary.spent_cents * summary.days_in_month) / days_elapsed);
  return {
    days_elapsed,
    daily_burn_cents,
    projected_spend_cents,
    projected_end_cents: summary.sobra_cents - projected_spend_cents,
  };
}

export interface Anomaly {
  id: number;
  category: string;
  amount_cents: number;
  median_cents: number;
  day: number;
}

const MIN_SAMPLES = 5; // below this a category has no pattern to deviate from

/** Median of an already-sorted array. */
function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Linear-interpolated quantile of an already-sorted array. p in [0,1]. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

const asc = (a: number, b: number) => a - b;

/** Spends in `current` that break their category's historical pattern.
 *  Median + 3×MAD — robust to the outliers it's looking for, unlike mean+stddev.
 *  ponytail: no seasonality — a month with a real doctor's visit will flag Saúde.
 *  Needs a per-month baseline if that gets annoying. */
export function anomalies(history: HistorySpend[], current: IdSpend[]): Anomaly[] {
  const byCat = new Map<string, number[]>();
  for (const h of history) {
    const cat = h.category?.trim() || "Outros";
    const arr = byCat.get(cat);
    if (arr) arr.push(h.amount_cents);
    else byCat.set(cat, [h.amount_cents]);
  }

  const stats = new Map<string, { median: number; threshold: number }>();
  for (const [cat, vals] of byCat) {
    if (vals.length < MIN_SAMPLES) continue;
    const med = median([...vals].sort(asc));
    const mad = median(vals.map((v) => Math.abs(v - med)).sort(asc));
    // ponytail: MAD 0 (repeated values — common at this volume) would flag every
    // value ≠ median. 2×median is the fallback; revisit if it fires too often.
    stats.set(cat, { median: med, threshold: mad === 0 ? med * 2 : med + 3 * mad });
  }

  const out: Anomaly[] = [];
  for (const s of current) {
    const cat = s.category?.trim() || "Outros";
    const st = stats.get(cat);
    if (!st || s.amount_cents <= st.threshold) continue;
    out.push({
      id: s.id,
      category: cat,
      amount_cents: s.amount_cents,
      median_cents: st.median,
      day: parseInt(s.spent_on.slice(8, 10), 10),
    });
  }
  return out.sort((a, b) => b.amount_cents - a.amount_cents);
}

// ---- forecasting the months ahead ----------------------------------------
// Most of this isn't a prediction. Income is fixed, every bill is recurring,
// and each installment has a known last month — so a future month's committed
// total is arithmetic over rows that already exist. That part a trend model
// can't do: it sees the total rising and extrapolates up, on a month the
// payment schedule already says will drop.
//
// What the arithmetic does NOT cover, measured by backtesting the real history
// (see the numbers before trusting this too much):
//   - committed MAE ~R$800/month, nearly unbiased (~-5%). The cause is churn:
//     ~8 bills appear and a similar value disappears every month. Baselines
//     scored the same or better (naive R$832, 3-month average R$675) — no
//     method tested wins, because next month's new bills are a decision the
//     user hasn't made yet, not a pattern in past values.
//   - band coverage is 3/7 months (2/3 in the recent, data-rich ones). Treat
//     it as indicative, not a calibrated interval.
// ponytail: the band is deliberately NOT tuned to hit a coverage target — with
// 7 points that would be fitting the backtest, which is the same overfit that
// rules out ARIMA/Prophet here. No trend, no seasonality either: telling
// December from noise needs 24+ months (two cycles) and there are six.
// Revisit when the history is long enough to disagree.

export interface ForecastBill {
  planned_cents: number;
  recurring: boolean;
  installment_current: number | null;
  installment_total: number | null;
}

export interface MonthForecast {
  month: string;
  income_cents: number;
  committed_cents: number; // known, not predicted
  sobra_cents: number;
  spend_low_cents: number; // p25 of past complete months
  spend_mid_cents: number; // median
  spend_high_cents: number; // p75
  end_low_cents: number; // sobra − spend_high: the bad case
  end_mid_cents: number;
  end_high_cents: number; // sobra − spend_low: the good case
  /** 'verde' — even the bad case closes positive. 'apertado' — the middle
   *  holds but the bad case doesn't. 'vermelho' — the middle is negative. */
  health: "verde" | "apertado" | "vermelho";
  /** How many complete months the spend band came from. 0 = band is a guess. */
  spend_samples: number;
  /** Slack the band adds for bills drifting from the schedule (see billNoise).
   *  0 when there's too little history to measure it. */
  bill_noise_cents: number;
  /** Installments paying off in this month — the money that frees up. This is
   *  the part a time-series model can't know: it sees the trend rising and
   *  extrapolates up, on a month the schedule already says will drop. */
  ends_cents: number;
  ends_count: number;
}

/** What `b` costs `k` months from now; 0 once it's gone. Mirrors rolloverMonth:
 *  only recurring bills carry, an installment ends when it's paid off, and the
 *  copy keeps planned_cents (actual_cents resets to null) — so planned is what
 *  a future month will actually charge. */
function billCostIn(b: ForecastBill, k: number): number {
  if (!b.recurring) return 0;
  const { installment_current: cur, installment_total: tot } = b;
  if (cur != null && tot != null && cur + k > tot) return 0; // paid off by then
  return b.planned_cents;
}

function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The typical size of a month-over-month move in the committed total — the
 *  median absolute delta.
 *  Backtesting on real history says the structural estimate is nearly unbiased
 *  (~-5%) but carries real noise: bills get added and dropped every month and
 *  roughly cancel out. Without this the band covers only daily-spend variance
 *  and reads far more precise than the backtest says it is.
 *  ponytail: median|Δ|, not MAD — MAD measures spread *around* the typical
 *  move, and collapses to 0 on a steady alternating series (+100,-100,+100),
 *  claiming no uncertainty exactly where there is some. Needs 3+ months. */
function billNoise(monthlyCommitted: number[]): number {
  if (monthlyCommitted.length < 3) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < monthlyCommitted.length; i++) {
    deltas.push(Math.abs(monthlyCommitted[i] - monthlyCommitted[i - 1]));
  }
  return median(deltas.sort(asc));
}

/** The next `horizon` months after `month`.
 *  `monthlySpends` and `monthlyCommitted` must be the totals of *complete* past
 *  months only — the month in progress would drag the median down with a
 *  half-empty number. `monthlyCommitted` must be in chronological order.
 *  Empty spends = no history: the band collapses to zero and `spend_samples`
 *  says so, rather than quietly promising the whole sobra. */
export function forecast(
  bills: ForecastBill[],
  income_cents: number,
  monthlySpends: number[],
  monthlyCommitted: number[],
  month: string,
  horizon = 3,
): MonthForecast[] {
  const sorted = [...monthlySpends].sort(asc);
  const low = sorted.length ? quantile(sorted, 0.25) : 0;
  const mid = sorted.length ? median(sorted) : 0;
  const high = sorted.length ? quantile(sorted, 0.75) : 0;
  const noise = billNoise(monthlyCommitted);

  const out: MonthForecast[] = [];
  for (let k = 1; k <= horizon; k++) {
    const committed_cents = bills.reduce((a, b) => a + billCostIn(b, k), 0);
    const sobra_cents = income_cents - committed_cents;
    // Bills alive last month and gone this one — an installment's last payment.
    const ending = bills.filter((b) => billCostIn(b, k - 1) > 0 && billCostIn(b, k) === 0);
    // The band carries both uncertainties: how much the daily spend varies, and
    // how much the bill total drifts from the schedule.
    const end_mid_cents = sobra_cents - mid;
    const end_low_cents = sobra_cents - high - noise;
    out.push({
      month: addMonths(month, k),
      income_cents,
      committed_cents,
      sobra_cents,
      spend_low_cents: low,
      spend_mid_cents: mid,
      spend_high_cents: high,
      end_low_cents,
      end_mid_cents,
      end_high_cents: sobra_cents - low + noise,
      health: end_mid_cents < 0 ? "vermelho" : end_low_cents < 0 ? "apertado" : "verde",
      spend_samples: sorted.length,
      bill_noise_cents: noise,
      ends_cents: ending.reduce((a, b) => a + b.planned_cents, 0),
      ends_count: ending.length,
    });
  }
  return out;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** The month's story, most important first. Templates only — each line is filled
 *  from the numbers above, so no line can state a figure the math didn't produce. */
export function insights(
  summary: Summary,
  bills: InsightBill[],
  projection: Projection | null,
  anoms: Anomaly[],
  fc: MonthForecast[],
  month: string,
  today: Date,
): string[] {
  const lines: string[] = [];
  const [y, m] = month.split("-").map(Number);
  const monthName = MONTH_NAMES[m - 1];

  if (projection) {
    const end = projection.projected_end_cents;
    const pace = `No ritmo de ${centsToBRL(projection.daily_burn_cents)}/dia você fecha ${monthName}`;
    lines.push(end < 0
      ? `${pace} no vermelho em ${centsToBRL(-end)}.`
      : `${pace} com ${centsToBRL(end)} sobrando.`);
  }

  if (summary.per_day_start_cents > 0 && summary.per_day_cents < summary.per_day_start_cents * 0.7) {
    lines.push(`Sua mesada caiu de ${centsToBRL(summary.per_day_start_cents)} para ${centsToBRL(summary.per_day_cents)}/dia.`);
  }

  const top = summary.by_category[0];
  if (top && summary.spent_cents > 0) {
    const pct = Math.round((top.cents / summary.spent_cents) * 100);
    if (pct >= 30) lines.push(`${top.category} concentra ${pct}% dos gastos do mês (${centsToBRL(top.cents)}).`);
  }

  const unpaid = bills.filter((b) => !b.paid);
  if (unpaid.length) {
    const total = unpaid.reduce((a, b) => a + (b.actual_cents ?? b.planned_cents), 0);
    // Only count a bill as "next" if it hasn't come due yet; day 0 for a month
    // that isn't the current one means every due day still counts.
    const todayDay = today.getFullYear() === y && today.getMonth() + 1 === m ? today.getDate() : 0;
    const upcoming = unpaid
      .map((b) => b.due_day)
      .filter((d): d is number => d != null && d >= todayDay)
      .sort(asc);
    const next = upcoming.length ? ` — a próxima vence dia ${upcoming[0]}` : "";
    const verb = unpaid.length === 1 ? "conta em aberto soma" : "contas em aberto somam";
    lines.push(`${unpaid.length} ${verb} ${centsToBRL(total)}${next}.`);
  }

  for (const a of anoms.slice(0, 2)) {
    lines.push(`${centsToBRL(a.amount_cents)} em ${a.category} no dia ${a.day} destoa do padrão (mediana ${centsToBRL(a.median_cents)}).`);
  }

  // The months ahead. Hedged on purpose: "~" and a range, never "fecha com X".
  // Backtesting puts the band at 3/7 coverage — it's the shape of the month,
  // not a promise, and the wording shouldn't claim more than that.
  for (const f of fc) {
    const name = MONTH_NAMES[Number(f.month.split("-")[1]) - 1];
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const freed = f.ends_count > 0
      ? ` ${centsToBRL(f.ends_cents)} saem (${f.ends_count === 1 ? "1 parcela termina" : `${f.ends_count} parcelas terminam`}).`
      : "";
    if (f.spend_samples === 0) {
      // Nothing to project the variable half from — say so instead of implying
      // the whole sobra survives the month.
      lines.push(`${label}: ${centsToBRL(f.sobra_cents)} de sobra depois das contas — sem histórico de gastos para projetar o resto.${freed}`);
      continue;
    }
    const range = `entre ${centsToBRL(f.end_low_cents)} e ${centsToBRL(f.end_high_cents)}`;
    lines.push(`${label} ~${centsToBRL(f.end_mid_cents)} (${range}) — ${f.health}.${freed}`);
  }

  return lines;
}
