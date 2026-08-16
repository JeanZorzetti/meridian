// Astro mounted this with `client:load`; the App Router needs the boundary
// declared in the file itself. Everything below runs in the browser, unchanged.
//
// TEMPORARY DUPLICATE of apps/site/src/components/react/BudgetApp.tsx, which is
// deleted when the site stops serving /admin (rodada C in docs/HANDOFF.md 8.3).
// Until then only one of the two is reachable at a time — the site's, because
// this app is not deployed yet. Change both or neither.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { brlToCents, centsToBRL, type Streak, type Summary } from "@meridian/core/budget";
import { CATEGORIES } from "@meridian/core/categorize";
import type { Anomaly, GoalView, MonthForecast, Pace, Projection } from "@meridian/core/insights";
import { interestOf, invoiceMonth } from "@meridian/core/cards";
import { Badge } from "@meridian/ui/components/badge";
import { appPath } from "@/lib/paths";

// ---- types (match the /api/month JSON shape; db.ts is server-only) ----
interface ApiIncome { id: number; label: string; amount_cents: number }
interface ApiBill {
  id: number; name: string; category: string; category_source: string; planned_cents: number;
  actual_cents: number | null; paid: boolean; pay_method: string | null;
  installment_current: number | null; installment_total: number | null;
  due_day: number | null; recurring: boolean; sort_order: number;
  card_id: number | null; principal_cents: number | null;
}
interface ApiSpend {
  id: number; spent_on: string; amount_cents: number;
  category: string; category_source: string; note: string | null; card_id: number | null;
}
interface ApiCard {
  id: number; label: string; closing_day: number; due_day: number;
  limit_cents: number | null; reserve_cents: number;
}
// One per card, for the month being viewed — see deriveInvoice() in src/lib/cards.ts.
interface ApiInvoice {
  card_id: number; card_label: string; month: string;
  itemized_cents: number; installments_cents: number; reserve_cents: number;
  expected_cents: number; total_cents: number | null; paid: boolean;
  unitemized_cents: number | null; limit_cents: number | null; used_cents: number;
}
// `forecast` is the months ahead; today only `lines` renders it. It's in the
// payload so a panel can use the numbers without a second roundtrip.
interface ApiInsights {
  projection: Projection | null; anomalies: Anomaly[];
  forecast: MonthForecast[]; pace: Pace | null; lines: string[];
}
interface MonthData {
  month: string; incomes: ApiIncome[]; bills: ApiBill[]; spends: ApiSpend[];
  summary: Summary; streak: Streak; goals: GoalView[]; insights: ApiInsights;
  cards: ApiCard[]; invoices: ApiInvoice[];
}

// Shared <datalist> for every category input. Native autocomplete over a known
// vocabulary — without it the column drifts into synonyms and the per-category
// stats never accumulate enough samples to mean anything.
const CAT_LIST = "cat-options";
function CategoryOptions() {
  return <datalist id={CAT_LIST}>{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>;
}

// ---- helpers ----
function shiftMonth(m: string, delta: number) {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string) {
  const [y, mm] = m.split("-").map(Number);
  const s = new Date(y, mm - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Parse a parcela count: blank or garbage → null (NaN would serialize to null
// anyway, but an explicit null keeps the intent — "not an installment" — clear).
function posInt(s: string): number | null {
  const n = Math.trunc(Number(s));
  return Number.isFinite(n) && n > 0 ? n : null;
}
// Every call site below writes the route as the app knows it ("/api/month/…").
// The base path is added here, in one place: Next does not rewrite fetch URLs,
// and a bare "/api/…" would leave this app and land on the Astro site.
async function api(url: string, method = "GET", body?: unknown) {
  const res = await fetch(appPath(url), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || res.statusText);
  }
  return res.json().catch(() => ({}));
}

const INPUT =
  "border-input bg-surface-1 focus-visible:ring-ring/50 h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:ring-2";

// ---- editable money field. `cents: null` renders empty (unset), e.g. an
// unreconciled "real" value. ponytail: clearing a set value back to null isn't
// supported via typing — it's an edge case; delete/re-add instead.
function MoneyInput({
  cents, onCommit, placeholder, className = "w-32",
}: { cents: number | null; onCommit: (c: number) => void; placeholder?: string; className?: string }) {
  const fmt = (c: number | null) => (c == null ? "" : centsToBRL(c));
  const [v, setV] = useState(fmt(cents));
  useEffect(() => setV(fmt(cents)), [cents]);
  return (
    <input
      className={`${INPUT} tnum text-right ${className}`}
      value={v}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() === "" && cents == null) return; // stayed empty → nothing to commit
        const c = brlToCents(v);
        if (c !== cents) onCommit(c);
        else setV(fmt(cents));
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

// ---- due-date badge: only surfaces when it matters (overdue / due soon) ----
function dueBadge(month: string, dueDay: number | null, paid: boolean) {
  if (paid || dueDay == null) return null;
  const [y, m] = month.split("-").map(Number);
  const due = new Date(y, m - 1, dueDay);
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: "atrasada", rose: true };
  if (days === 0) return { text: "vence hoje", rose: true };
  if (days <= 3) return { text: `vence em ${days}d`, rose: false };
  return null;
}

// ---- labelled field for the expanded bill editor ----
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

// ---- burn-down: remaining discretionary pool per day vs the ideal line ----
function Burndown({ summary, month, projection }: {
  summary: Summary; month: string; projection: Projection | null;
}) {
  const W = 560, H = 150, PADX = 4, PADT = 10, PADB = 4;
  const pts = summary.burndown;
  if (!pts.length) return null;
  const vals = pts.map((p) => p.remaining_cents).concat([0, summary.sobra_cents]);
  if (projection) vals.push(projection.projected_end_cents); // keep the forecast on-canvas
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const innerH = H - PADT - PADB;
  const x = (i: number) => PADX + (i / (pts.length - 1)) * (W - PADX * 2);
  const y = (c: number) => PADT + (1 - (c - min) / span) * innerH;

  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)},${y(p.remaining_cents).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(pts.length - 1).toFixed(1)},${y(min).toFixed(1)} L ${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const ideal = `M ${x(0)},${y(summary.sobra_cents)} L ${x(pts.length - 1)},${y(0)}`;
  const zeroY = y(0);

  const [ty, tm] = [new Date().getFullYear(), new Date().getMonth() + 1];
  const [y0, m0] = month.split("-").map(Number);
  const todayI = ty === y0 && tm === m0 ? new Date().getDate() - 1 : -1;

  // Where today's pace lands by month end. project() only returns non-null for
  // the current month, so todayI is always a real index here.
  const proj = projection && todayI >= 0 && todayI < pts.length
    ? `M ${x(todayI).toFixed(1)},${y(pts[todayI].remaining_cents).toFixed(1)} L ${x(pts.length - 1).toFixed(1)},${y(projection.projected_end_cents).toFixed(1)}`
    : null;
  const projRose = !!projection && projection.projected_end_cents < 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" role="img"
      aria-label={projection
        ? `Sobra restante por dia do mês, projetada para ${centsToBRL(projection.projected_end_cents)} no fim do mês`
        : "Sobra restante por dia do mês"}>
      <defs>
        <linearGradient id="bd-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3ecf8e" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#3ecf8e" stopOpacity="0" />
        </linearGradient>
      </defs>
      {min < 0 && max > 0 && (
        <line x1={PADX} y1={zeroY} x2={W - PADX} y2={zeroY} stroke="#f0616d" strokeWidth="1"
          strokeDasharray="3 3" opacity="0.5" vectorEffect="non-scaling-stroke" />
      )}
      <path d={ideal} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4"
        className="text-foreground/25" vectorEffect="non-scaling-stroke" />
      {proj && (
        <path d={proj} fill="none" stroke={projRose ? "#f0616d" : "#3ecf8e"} strokeWidth="1.25"
          strokeDasharray="2 3" opacity="0.75" vectorEffect="non-scaling-stroke" />
      )}
      <path d={area} fill="url(#bd-area)" />
      <path d={line} fill="none" stroke="#3ecf8e" strokeWidth="1.75" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" />
      {todayI >= 0 && (
        <line x1={x(todayI)} y1={PADT} x2={x(todayI)} y2={H - PADB} stroke="#3ecf8e" strokeWidth="1"
          opacity="0.4" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

// ---- insights: the month read back in words. Every figure comes from
// src/lib/insights.ts arithmetic — nothing here is generated text.
function InsightsPanel({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="border-border mt-6 flex flex-col gap-2 rounded-lg border px-4 py-3">
      {lines.map((l) => (
        <li key={l} className="text-muted-foreground flex gap-2.5 text-sm">
          <span aria-hidden="true" className="text-primary/70 select-none">—</span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- pace: how far the burndown sits from the ideal line, in days of baseline
// allowance. Days is this product's currency — "2,3 dias à frente" lands where
// "R$ 340 acima da linha" doesn't.
function PaceLine({ pace }: { pace: Pace }) {
  if (pace.days === 0) return <p className="text-muted-foreground mt-2 text-xs">Exatamente no ritmo da linha ideal.</p>;
  const ahead = pace.days > 0;
  const n = Math.abs(pace.days);
  const num = n % 1 === 0 ? String(n) : n.toFixed(1).replace(".", ","); // 2,3 — and no ",0" noise
  return (
    // Behind the pace is muted, never destructive: it's a direction, not an error.
    <p className={`mt-2 text-xs ${ahead ? "text-primary" : "text-muted-foreground"}`}>
      <span className="tnum">{num}</span> {n === 1 ? "dia" : "dias"} {ahead ? "à frente do" : "atrás do"} ritmo ·{" "}
      <span className="tnum">{centsToBRL(Math.abs(pace.delta_cents))}</span> {ahead ? "acima" : "abaixo"} da linha ideal
    </p>
  );
}

// ---- metric tile ----
function Metric({ label, value, tone }: { label: string; value: string; tone?: "mint" | "rose" }) {
  const color = tone === "mint" ? "text-primary" : tone === "rose" ? "text-destructive" : "";
  return (
    <div className="border-border border-t px-4 py-3 sm:border-t-0 sm:border-l first:border-l-0">
      <p className="eyebrow">{label}</p>
      <p className={`tnum mt-1 text-lg font-semibold tracking-[-0.01em] ${color}`}>{value}</p>
    </div>
  );
}

export default function BudgetApp({ initial, username }: { initial: MonthData; username: string }) {
  const [month, setMonth] = useState(initial.month);
  const [data, setData] = useState<MonthData>(initial);
  const [busy, setBusy] = useState(false);
  // Tone, because the same slot now carries good news: a mint allowance update
  // dressed in destructive red would be a visual lie.
  const [toast, setToast] = useState<{ msg: string; tone: "info" | "error" } | null>(null);
  const first = useRef(true);

  const notify = useCallback((msg: string, tone: "info" | "error" = "error") => {
    setToast({ msg, tone });
    setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 4000);
  }, []);

  const refresh = useCallback(async (m: string) => {
    const d = await api(`/api/month/${m}`);
    setData(d);
  }, []);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setBusy(true);
    refresh(month).catch((e) => notify(e.message)).finally(() => setBusy(false));
  }, [month, refresh, notify]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refresh(month); }
    catch (e) { notify((e as Error).message); }
    finally { setBusy(false); }
  }, [month, refresh, notify]);

  const s = data.summary;
  const ins = data.insights;
  const groups = useMemo(() => {
    const map = new Map<string, ApiBill[]>();
    for (const b of data.bills) (map.get(b.category) ?? map.set(b.category, []).get(b.category)!).push(b);
    return [...map.entries()];
  }, [data.bills]);
  const empty = data.bills.length === 0 && data.incomes.length === 0;
  const cardsById = useMemo(() => new Map(data.cards.map((c) => [c.id, c])), [data.cards]);

  return (
    <div className="wrap py-6">
      <CategoryOptions />
      {/* header */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="inline-flex items-center gap-2.5" aria-label="Meridian home">
          <svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="9.25" stroke="currentColor" strokeWidth="1.5" className="text-foreground/70" />
            <path d="M2 11h18" stroke="#3ecf8e" strokeWidth="1.5" />
            <path d="M11 1.75v18.5" stroke="currentColor" strokeWidth="1.5" className="text-foreground/25" />
          </svg>
          <span className="font-semibold tracking-[-0.02em]">Meridian</span>
        </a>
        <div className="flex items-center gap-1.5">
          <button aria-label="mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}
            className="border-border hover:bg-accent flex h-8 w-8 items-center justify-center rounded-md border text-sm">‹</button>
          {/* native month picker — jump to any month with zero JS */}
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label={monthLabel(month)}
            className="border-border bg-surface-1 tnum h-8 rounded-md border px-2 text-center text-sm font-medium outline-none" />
          <button aria-label="próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}
            className="border-border hover:bg-accent flex h-8 w-8 items-center justify-center rounded-md border text-sm">›</button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-xs sm:inline">{username}</span>
          <form method="POST" action={appPath("/api/logout")}>
            <button className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-xs">Sair</button>
          </form>
        </div>
      </header>

      {empty ? (
        <EmptyMonth month={month} onRollover={() => act(() => api("/api/rollover", "POST", { from: shiftMonth(month, -1), to: month }))}
          onSeedIncome={() => act(() => api("/api/income", "POST", { month, amount_cents: 0 }))} busy={busy} />
      ) : (
        <>
          {/* hero — the signature number. tilt/glow-mint are the cinematic layer
              the marketing site uses; glow-mint is reserved by CSS comment for
              exactly this signature card. data-tilt="2" (not 6): a dense grid of
              numbers is not a marketing card, so the lean is barely there. */}
          <section className="border-border bg-card ring-foreground/10 tilt glow-mint relative overflow-hidden rounded-xl border p-6 ring-1"
            data-tilt="2">
            <span className="glare" aria-hidden="true" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="eyebrow">Você pode gastar hoje</p>
                  {/* 0 is a scolding, not information — it doesn't render. */}
                  {data.streak.days > 0 && (
                    <Badge variant="outline" className="border-primary/30 text-primary gap-1"
                      title="Dias seguidos, até ontem, em que o gasto ficou dentro da mesada daquele dia. Um dia sem gasto lançado conta como dentro.">
                      <span className="tnum">{data.streak.days}</span>
                      {data.streak.days === 1 ? "dia dentro" : "dias dentro"}
                    </Badge>
                  )}
                </div>
                <p className={`tnum mt-2 text-5xl font-semibold tracking-[-0.03em] sm:text-6xl ${s.per_day_cents < 0 ? "text-destructive" : "text-primary"}`}>
                  {centsToBRL(s.per_day_cents)}
                </p>
                <p className="text-muted-foreground mt-3 text-sm">
                  <span className="tnum">{s.days_remaining}</span> {s.days_remaining === 1 ? "dia restante" : "dias restantes"} ·
                  baseline <span className="tnum">{centsToBRL(s.per_day_start_cents)}</span>/dia
                </p>
              </div>
              <div>
                <div className="h-36 sm:h-40">
                  <Burndown summary={s} month={month} projection={ins.projection} />
                </div>
                {ins.pace && <PaceLine pace={ins.pace} />}
              </div>
            </div>
            <div className={`border-border mt-6 grid grid-cols-2 rounded-lg border ${data.cards.length ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
              <Metric label="Entrada" value={centsToBRL(s.income_cents)} />
              <Metric label="Comprometido" value={centsToBRL(s.committed_cents)} />
              <Metric label="Sobra" value={centsToBRL(s.sobra_cents)} tone={s.sobra_cents < 0 ? "rose" : "mint"} />
              <Metric label="Gasto no mês" value={centsToBRL(s.spent_cents)} />
              <Metric label="A pagar" value={centsToBRL(s.unpaid_cents)} tone={s.unpaid_cents > 0 ? "rose" : undefined} />
              {/* only once a card exists — otherwise it's the same number as
                  Comprometido and would just be visual noise. */}
              {data.cards.length > 0 && <Metric label="Sai da conta" value={centsToBRL(s.cash_out_cents)} />}
            </div>
            <InsightsPanel lines={ins.lines} />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <BillsPanel month={month} groups={groups} incomes={data.incomes} cards={data.cards} act={act} />
            <div className="flex flex-col gap-6">
              <DailyPanel month={month} spends={data.spends} anomalies={ins.anomalies} act={act} summary={s}
                notify={notify} cards={data.cards} cardsById={cardsById} />
              <CategoryBreakdown data={s.by_category} rows={[...data.bills, ...data.spends]} />
            </div>
          </div>
          <CardsPanel month={month} cards={data.cards} invoices={data.invoices} act={act} />
          <GoalsPanel goals={data.goals} act={act} />
          <Trends />
        </>
      )}
      {busy && <div className="text-muted-foreground fixed bottom-4 right-4 text-xs">salvando…</div>}
      {toast && (
        <div role="alert"
          className={`tnum fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg ${
            toast.tone === "info"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}>
          <button onClick={() => setToast(null)} className="flex items-center gap-2" aria-label="fechar aviso">
            {toast.msg} <span className="opacity-60">×</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---- empty month ----
function EmptyMonth({ month, onRollover, onSeedIncome, busy }: {
  month: string; onRollover: () => void; onSeedIncome: () => void; busy: boolean;
}) {
  return (
    <div className="border-border bg-card ring-foreground/10 rounded-xl border p-10 text-center ring-1">
      <p className="eyebrow">{monthLabel(month)}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">Mês vazio</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
        Gere as contas a partir de <strong>{monthLabel(shiftMonth(month, -1))}</strong> (parcelas avançam,
        as concluídas somem) ou comece do zero.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <button disabled={busy} onClick={onRollover}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium">
          Gerar a partir do mês anterior
        </button>
        <button disabled={busy} onClick={onSeedIncome}
          className="border-border hover:bg-accent inline-flex h-10 items-center rounded-md border px-4 text-sm">
          Começar em branco
        </button>
      </div>
    </div>
  );
}

// ---- bills ----
function BillsPanel({ month, groups, incomes, cards, act }: {
  month: string; groups: [string, ApiBill[]][]; incomes: ApiIncome[]; cards: ApiCard[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  // Reconciling a bill (filling its real amount) turns closing the month into a
  // bar with an end. `actual_cents != null` is the whole definition.
  const total = groups.reduce((a, [, bs]) => a + bs.length, 0);
  const done = groups.reduce((a, [, bs]) => a + bs.filter((b) => b.actual_cents != null).length, 0);
  return (
    <section className="border-border bg-card ring-foreground/10 rounded-xl border ring-1">
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Contas</h2>
        <div className="flex items-center gap-2.5">
          {total > 0 && (done === total
            ? <Badge variant="secondary" title="Toda conta tem o valor real conciliado.">mês fechado</Badge>
            : (
              <span className="text-muted-foreground flex items-center gap-2 text-xs"
                title="Contas com o valor real preenchido, de todas as contas do mês.">
                <span className="tnum">{done}/{total}</span> conciliadas
                <span className="bg-surface-1 h-1.5 w-16 overflow-hidden rounded-full">
                  <span className="bg-primary block h-full rounded-full" style={{ width: `${(done / total) * 100}%` }} />
                </span>
              </span>
            ))}
          <button onClick={() => setAdding((a) => !a)}
            className="border-border hover:bg-accent inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs">
            + nova conta
          </button>
        </div>
      </div>

      {/* incomes */}
      <div className="border-border border-b">
        <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
          <span className="eyebrow">Entradas</span>
          <button onClick={() => act(() => api("/api/income", "POST", { month, amount_cents: 0 }))}
            className="text-muted-foreground hover:text-foreground text-xs">+ entrada</button>
        </div>
        {incomes.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-2.5 text-xs">Nenhuma entrada — clique em “+ entrada”.</p>
        ) : (
          incomes.map((inc) => <IncomeRow key={inc.id} income={inc} act={act} />)
        )}
      </div>

      {adding && <AddBill month={month} onDone={() => setAdding(false)} act={act} />}

      {groups.map(([cat, bills]) => {
        const subtotal = bills.reduce((a, b) => a + (b.actual_cents ?? b.planned_cents), 0);
        const sorted = [...bills].sort((a, b) => (a.due_day ?? 99) - (b.due_day ?? 99));
        return (
          <div key={cat}>
            <div className="bg-surface-1/40 border-border flex items-center justify-between border-b px-4 py-1.5">
              <span className="eyebrow">{cat}</span>
              <span className="tnum text-muted-foreground text-xs">{centsToBRL(subtotal)}</span>
            </div>
            {sorted.map((b) => <BillRow key={b.id} bill={b} month={month} cards={cards} act={act} />)}
          </div>
        );
      })}
    </section>
  );
}

function IncomeRow({ income: inc, act }: {
  income: ApiIncome; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="group flex items-center gap-3 px-4 py-1.5">
      <input
        aria-label="rótulo da entrada"
        defaultValue={inc.label}
        onBlur={(e) => {
          const label = e.target.value.trim();
          if (label && label !== inc.label) act(() => api(`/api/income/${inc.id}`, "PATCH", { label }));
        }}
        className={`${INPUT} h-8 min-w-0 flex-1`}
      />
      <MoneyInput cents={inc.amount_cents}
        onCommit={(c) => act(() => api(`/api/income/${inc.id}`, "PATCH", { amount_cents: c }))} />
      <button aria-label="excluir entrada"
        onClick={() => confirm(`Excluir a entrada “${inc.label}”?`) && act(() => api(`/api/income/${inc.id}`, "DELETE"))}
        className="text-foreground/30 hover:text-destructive shrink-0 text-lg leading-none">×</button>
    </div>
  );
}

function BillRow({ bill: b, month, cards, act }: {
  bill: ApiBill; month: string; cards: ApiCard[]; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const badge = dueBadge(month, b.due_day, b.paid);
  // the number that drives the math (mirrors billCost in budget.ts)
  const effective = b.actual_cents ?? b.planned_cents;
  const reconciled = b.actual_cents != null && b.actual_cents !== b.planned_cents;

  return (
    <div className="border-border border-b last:border-b-0">
      {/* collapsed row — only what you scan for */}
      <div className="hover:bg-white/[0.02] flex items-center gap-3 px-4 py-2">
        <button
          aria-label={b.paid ? "marcar como pendente" : "marcar como pago"}
          onClick={() => act(() => api(`/api/bills/${b.id}`, "PATCH", { paid: !b.paid }))}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] ${
            b.paid ? "bg-primary text-primary-foreground border-transparent" : "border-input text-transparent"
          }`}
        >✓</button>

        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left" title="editar detalhes">
          <span className={`truncate text-sm ${b.paid ? "text-muted-foreground line-through" : ""}`}>{b.name}</span>
          {b.installment_current != null && b.installment_total != null && (
            <span className="border-border tnum text-muted-foreground shrink-0 rounded-full border px-1.5 text-[10px]">
              {b.installment_current}/{b.installment_total}
            </span>
          )}
          {badge && (
            <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
              badge.rose ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"
            }`}>{badge.text}</span>
          )}
          {b.pay_method && (
            <span className="text-muted-foreground shrink-0 text-[10px]">{b.pay_method}</span>
          )}
          {b.card_id != null && (
            <span className="border-border text-muted-foreground shrink-0 rounded-full border px-1.5 text-[10px]">
              {cards.find((c) => c.id === b.card_id)?.label ?? "cartão"}
            </span>
          )}
        </button>

        {/* edits whichever value the math actually uses; the editor below splits them */}
        <MoneyInput cents={effective}
          className={`w-28 ${reconciled ? (b.actual_cents! > b.planned_cents ? "text-destructive" : "text-primary") : ""}`}
          onCommit={(c) => act(() => api(`/api/bills/${b.id}`, "PATCH",
            b.actual_cents != null ? { actual_cents: c } : { planned_cents: c }))} />

        <button onClick={() => setOpen((o) => !o)} aria-label={open ? "fechar detalhes" : "abrir detalhes"}
          aria-expanded={open}
          className={`text-foreground/30 hover:text-foreground shrink-0 text-xs transition-transform ${open ? "rotate-90" : ""}`}>›</button>

        <button aria-label="excluir"
          onClick={() => confirm(`Excluir “${b.name}”?`) && act(() => api(`/api/bills/${b.id}`, "DELETE"))}
          className="text-foreground/25 hover:text-destructive focus-visible:text-destructive shrink-0 text-lg leading-none">×</button>
      </div>

      {open && <BillEditor bill={b} cards={cards} act={act} />}
    </div>
  );
}

// ---- expanded editor: everything secondary lives here, not in the row ----
function BillEditor({ bill: b, cards, act }: {
  bill: ApiBill; cards: ApiCard[]; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const patch = (body: Record<string, unknown>) => act(() => api(`/api/bills/${b.id}`, "PATCH", body));
  // Local state for the two installment inputs: they commit together (a current
  // without a total means nothing, and the badge only shows when both are set).
  const [cur, setCur] = useState(b.installment_current?.toString() ?? "");
  const [tot, setTot] = useState(b.installment_total?.toString() ?? "");
  const commitInstallment = () => {
    const total = posInt(tot);
    const current = total ? Math.min(total, posInt(cur) ?? 1) : null;
    if (current !== b.installment_current || total !== b.installment_total) {
      patch({ installment_current: current, installment_total: total });
    }
  };
  return (
    <div className="bg-surface-1/40 border-border grid gap-3 border-t px-4 py-3 sm:grid-cols-2">
      <Field label="nome">
        <input defaultValue={b.name} className={`${INPUT} w-full`}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== b.name) patch({ name: v }); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </Field>
      <Field label="categoria">
        <input defaultValue={b.category} list={CAT_LIST} className={`${INPUT} w-full`}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== b.category) patch({ category: v }); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </Field>
      <Field label="dia de vencimento">
        {/* text+numeric, not type=number: spinners steal width and add nothing here */}
        <input defaultValue={b.due_day ?? ""} placeholder="—" inputMode="numeric" className={`${INPUT} tnum w-full`}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const day = raw === "" ? null : Math.min(31, Math.max(1, Math.trunc(Number(raw))));
            if (!Number.isNaN(day) && day !== b.due_day) patch({ due_day: day });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </Field>
      <Field label="forma de pagamento">
        <select value={b.pay_method ?? ""} className={`${INPUT} w-full`}
          onChange={(e) => patch({ pay_method: e.target.value || null })}>
          <option value="">—</option>
          <option value="caixa">caixa</option>
          <option value="cartão">cartão</option>
        </select>
      </Field>
      {cards.length > 0 && (
        <Field label="cartão">
          <select value={b.card_id ?? ""} className={`${INPUT} w-full`}
            onChange={(e) => patch({ card_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      )}
      {b.card_id != null && (
        <Field label="valor enviado (se financiado)">
          <MoneyInput cents={b.principal_cents} placeholder="sem juros" className="w-full"
            onCommit={(c) => patch({ principal_cents: c })} />
        </Field>
      )}
      <Field label="planejado">
        <MoneyInput cents={b.planned_cents} className="w-full"
          onCommit={(c) => patch({ planned_cents: c })} />
      </Field>
      <Field label="real (conciliado)">
        <MoneyInput cents={b.actual_cents} placeholder="não conciliado" className="w-full"
          onCommit={(c) => patch({ actual_cents: c })} />
      </Field>
      <Field label="parcela (atual / total)">
        <span className="flex items-center gap-1.5">
          <input value={cur} inputMode="numeric" placeholder="—" aria-label="parcela atual"
            onChange={(e) => setCur(e.target.value)} onBlur={commitInstallment}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={`${INPUT} tnum w-16 text-center`} />
          <span className="text-muted-foreground">/</span>
          <input value={tot} inputMode="numeric" placeholder="—" aria-label="total de parcelas"
            onChange={(e) => setTot(e.target.value)} onBlur={commitInstallment}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={`${INPUT} tnum w-16 text-center`} />
        </span>
      </Field>
      <label className="text-muted-foreground flex items-center gap-2 text-xs sm:col-span-2">
        <input type="checkbox" checked={b.recurring} className="accent-primary h-4 w-4"
          onChange={(e) => patch({ recurring: e.target.checked })} />
        recorrente (rola pro próximo mês)
      </label>
    </div>
  );
}

function AddBill({ month, onDone, act }: {
  month: string; onDone: () => void; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [cat, setCat] = useState("");
  const [day, setDay] = useState("");
  // Installment: `tot` is the number of parcelas; `cur` which one this month is
  // (defaults to 1 — a purchase you're registering fresh starts at 1/N; set it
  // higher when migrating one already mid-way, like 2/4). recurring stays true
  // (the server default) so rollover advances it 1/4 → 2/4 and drops it at N/N.
  const [cur, setCur] = useState("");
  const [tot, setTot] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    const total = posInt(tot);
    const current = total ? Math.min(total, posInt(cur) ?? 1) : null;
    // No category sent -> the server infers it from the name (src/lib/categorize.ts).
    act(() => api("/api/bills", "POST", {
      month, name: name.trim(), category: cat.trim() || null, planned_cents: brlToCents(value),
      due_day: day.trim() ? Math.min(31, Math.max(1, Math.trunc(Number(day)))) : null,
      installment_current: current, installment_total: total,
    })).then(onDone);
  };
  return (
    <div className="border-border bg-surface-1/40 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <input autoFocus placeholder="nome" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} flex-1`} />
      <input placeholder="categoria (auto)" value={cat} list={CAT_LIST}
        onChange={(e) => setCat(e.target.value)} className={`${INPUT} w-32`} />
      <input placeholder="dia" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-16 text-center`} />
      {/* parcela N/M — leave blank for a normal (non-installment) bill */}
      <span className="flex items-center gap-1" title="Parcela: nº atual / total. Deixe vazio se não for parcelado.">
        <input placeholder="—" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="parcela atual"
          className={`${INPUT} tnum w-12 text-center`} />
        <span className="text-muted-foreground text-sm">/</span>
        <input placeholder="parc." inputMode="numeric" value={tot} onChange={(e) => setTot(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="total de parcelas"
          className={`${INPUT} tnum w-14 text-center`} />
      </span>
      <input placeholder="R$ 0,00" value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-28 text-right`} />
      <button onClick={submit}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-3 text-sm">add</button>
      <button onClick={onDone} className="text-muted-foreground text-sm">cancelar</button>
    </div>
  );
}

// ---- spend-by-category breakdown (bars ∝ largest category) ----
const CAT_COLORS = ["#3ecf8e", "#6ee7b7", "#f0616d", "#fbbf77", "#8ab4f8", "#c4b5fd", "#94a3b8"];
function CategoryBreakdown({ data, rows }: {
  data: { category: string; cents: number }[];
  rows: { category_source: string }[]; // every bill + spend, for the accuracy line
}) {
  const total = data.reduce((a, c) => a + c.cents, 0);
  if (total <= 0) return null;
  const max = data[0].cents; // data is sorted desc by summarize()
  // "Accepted", never "correct". A row the user never touched keeps its guessed
  // source — not touching it isn't confirming it's right.
  const accepted = rows.filter((r) => r.category_source !== "user").length;
  // ponytail: a .reveal target's className must stay a static literal — the IO
  // writes is-visible onto the node, and a re-render with a different className
  // would wipe the class and hide the card for good (it was already unobserved).
  return (
    <section className="reveal border-border bg-card ring-foreground/10 h-fit rounded-xl border ring-1">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Gasto por categoria</h2>
        <span className="tnum text-muted-foreground text-xs">{centsToBRL(total)}</span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {data.map((c, i) => (
          <div key={c.category}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{c.category}</span>
              <span className="tnum text-muted-foreground shrink-0">
                {centsToBRL(c.cents)} · {Math.round((c.cents / total) * 100)}%
              </span>
            </div>
            <div className="bg-surface-1 h-2 overflow-hidden rounded-full">
              {/* .bar grows from 0 to --w once the card reveals (global.css). */}
              <div className="bar h-full rounded-full"
                style={{ "--w": `${(c.cents / max) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] } as CSSProperties} />
            </div>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="border-border text-muted-foreground border-t px-4 py-2.5 text-xs"
          title={
            "Linhas que o Meridian categorizou e você não corrigiu, deste mês. " +
            "Não é taxa de acerto: uma sugestão errada que você não olhou conta como aceita, " +
            "e corrigir apaga a própria evidência (a linha vira 'user' e sai da conta). " +
            "Uma categoria que você digitou de saída também conta como não-aceita — o viés é pessimista de propósito."
          }>
          <span className="tnum">{accepted}</span> de <span className="tnum">{rows.length}</span> sugestões aceitas
        </div>
      )}
    </section>
  );
}

// ---- credit cards: the fatura is always derived, never a line the user types
// in (see deriveInvoice() in src/lib/cards.ts). This panel only ever writes
// three things: a card's own dates/limit/reserve, a bill's card_id+principal
// (the financed-purchase form below), and the extrato's real total once it
// arrives — everything else on screen is arithmetic over rows that already exist.
function InvoiceRow({ invoice: inv, month, act }: {
  invoice: ApiInvoice; month: string; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const pct = inv.limit_cents ? Math.min(100, Math.round((inv.used_cents / inv.limit_cents) * 100)) : null;
  const setExtrato = (total_cents: number | null, paid: boolean) =>
    act(() => api("/api/invoices", "POST", { card_id: inv.card_id, month, total_cents, paid }));

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{inv.card_label}</span>
        <div className="flex items-center gap-2">
          {inv.paid
            ? <Badge variant="secondary">paga</Badge>
            : (
              <button onClick={() => setExtrato(inv.total_cents, true)}
                className="border-border hover:bg-accent inline-flex h-7 items-center rounded-md border px-2 text-xs">marcar paga</button>
            )}
          <button aria-label="excluir cartão"
            onClick={() => confirm(`Excluir o cartão "${inv.card_label}"? Contas e gastos já lançados continuam, só soltos do cartão.`)
              && act(() => api(`/api/cards/${inv.card_id}`, "DELETE"))}
            className="text-foreground/25 hover:text-destructive focus-visible:text-destructive text-lg leading-none">×</button>
        </div>
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>itemizado <span className="tnum text-foreground">{centsToBRL(inv.itemized_cents)}</span></span>
        <span>parcelas <span className="tnum text-foreground">{centsToBRL(inv.installments_cents)}</span></span>
        {inv.reserve_cents > 0 && <span>reserva <span className="tnum text-foreground">{centsToBRL(inv.reserve_cents)}</span></span>}
        <span>previsto <span className="tnum text-foreground">{centsToBRL(inv.expected_cents)}</span></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-xs">extrato</span>
        <MoneyInput cents={inv.total_cents} placeholder="ainda não chegou" className="w-32"
          onCommit={(c) => setExtrato(c, inv.paid)} />
        {inv.unitemized_cents != null && (
          <span className="text-muted-foreground text-xs">
            <span className="tnum">{centsToBRL(inv.unitemized_cents)}</span> não itemizados
          </span>
        )}
      </div>
      {inv.limit_cents != null && pct != null && (
        <div className="mt-2">
          <div className="bg-surface-1 h-1.5 overflow-hidden rounded-full">
            <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            <span className="tnum">{centsToBRL(inv.used_cents)}</span> / <span className="tnum">{centsToBRL(inv.limit_cents)}</span> do limite
          </p>
        </div>
      )}
    </div>
  );
}

function AddCard({ onDone, act }: {
  onDone: () => void; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [limit, setLimit] = useState("");
  const submit = () => {
    const closing_day = closingDay.trim() ? Math.min(31, Math.max(1, Math.trunc(Number(closingDay)))) : null;
    const due_day = dueDay.trim() ? Math.min(31, Math.max(1, Math.trunc(Number(dueDay)))) : null;
    if (!label.trim() || !closing_day || !due_day) return;
    act(() => api("/api/cards", "POST", {
      label: label.trim(), closing_day, due_day,
      limit_cents: limit.trim() ? brlToCents(limit) : null,
    })).then(onDone);
  };
  return (
    <div className="border-border bg-surface-1/40 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <input autoFocus placeholder="nome (ex: Nubank)" value={label} onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} flex-1`} />
      <input placeholder="fecha (dia)" inputMode="numeric" value={closingDay} onChange={(e) => setClosingDay(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-24 text-center`} />
      <input placeholder="vence (dia)" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-24 text-center`} />
      <input placeholder="limite (opcional)" value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-32 text-right`} />
      <button onClick={submit}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-3 text-sm">add</button>
      <button onClick={onDone} className="text-muted-foreground text-sm">cancelar</button>
    </div>
  );
}

// ---- PIX no crédito / compra parcelada com juros: the one form that creates a
// financed bill. Interest is shown before saving, not after — the number meant
// to change behavior has to land before the commitment, not buried in a report
// afterward. Posts to the invoice's due month (invoiceMonth()), not necessarily
// the month being viewed — a purchase near the closing day bills next cycle.
function AddFinancedPurchase({ cards, onDone, act }: {
  cards: ApiCard[]; onDone: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [cardId, setCardId] = useState(String(cards[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [principal, setPrincipal] = useState("");
  const [installments, setInstallments] = useState("1");
  const [installmentValue, setInstallmentValue] = useState("");

  const card = cards.find((c) => String(c.id) === cardId);
  const n = posInt(installments) ?? 1;
  const principal_cents = brlToCents(principal);
  const planned_cents = brlToCents(installmentValue);
  const preview = principal_cents > 0 && planned_cents > 0
    ? interestOf({ planned_cents, installment_total: n, principal_cents })
    : null;

  const submit = () => {
    if (!card || !name.trim() || principal_cents <= 0 || planned_cents <= 0) return;
    act(() => api("/api/bills", "POST", {
      month: invoiceMonth(date, card.closing_day, card.due_day),
      name: name.trim(), planned_cents, card_id: card.id, principal_cents,
      installment_current: 1, installment_total: n, due_day: card.due_day,
    })).then(onDone);
  };

  return (
    <div className="border-border bg-surface-1/40 flex flex-col gap-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="cartão" value={cardId} onChange={(e) => setCardId(e.target.value)} className={`${INPUT} w-32 shrink-0`}>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input autoFocus placeholder="nome (ex: PIX loja)" value={name} onChange={(e) => setName(e.target.value)}
          className={`${INPUT} flex-1`} />
        <input type="date" aria-label="data da compra" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="valor enviado" value={principal} inputMode="decimal" onChange={(e) => setPrincipal(e.target.value)}
          className={`${INPUT} tnum w-32 text-right`} />
        <span className="text-muted-foreground text-xs">em</span>
        <input placeholder="parcelas" inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)}
          className={`${INPUT} tnum w-16 text-center`} />
        <span className="text-muted-foreground text-xs">x de</span>
        <input placeholder="valor da parcela" value={installmentValue} inputMode="decimal" onChange={(e) => setInstallmentValue(e.target.value)}
          className={`${INPUT} tnum w-32 text-right`} />
        <button onClick={submit}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-3 text-sm">add</button>
        <button onClick={onDone} className="text-muted-foreground text-sm">cancelar</button>
      </div>
      {preview && (
        <p className={`text-xs ${preview.total_cents > 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {preview.total_cents > 0
            ? <>Juros: <span className="tnum">{centsToBRL(preview.total_cents)}</span> no total (<span className="tnum">{centsToBRL(preview.per_installment_cents)}</span>/parcela).</>
            : "Sem juros — valor enviado cobre o total das parcelas."}
        </p>
      )}
    </div>
  );
}

function CardsPanel({ month, cards, invoices, act }: {
  month: string; cards: ApiCard[]; invoices: ApiInvoice[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [financing, setFinancing] = useState(false);
  return (
    <section className="reveal border-border bg-card ring-foreground/10 mt-6 rounded-xl border ring-1">
      <div className={`flex items-center justify-between px-4 py-3 ${cards.length || adding || financing ? "border-border border-b" : ""}`}>
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Cartões</h2>
        <div className="flex items-center gap-2">
          {cards.length > 0 && (
            <button onClick={() => setFinancing((f) => !f)}
              className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-2.5 text-xs">+ PIX no crédito</button>
          )}
          <button onClick={() => setAdding((a) => !a)}
            className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-2.5 text-xs">+ novo cartão</button>
        </div>
      </div>
      {adding && <AddCard onDone={() => setAdding(false)} act={act} />}
      {financing && cards.length > 0 && <AddFinancedPurchase cards={cards} onDone={() => setFinancing(false)} act={act} />}
      {cards.length === 0
        ? (!adding && <p className="text-muted-foreground px-4 py-6 text-center text-xs">Nenhum cartão cadastrado.</p>)
        : (
          <div className="divide-border flex flex-col divide-y">
            {invoices.map((inv) => <InvoiceRow key={inv.card_id} invoice={inv} month={month} act={act} />)}
          </div>
        )}
    </section>
  );
}

// ---- savings goals: a target + a hedged ETA drawn from the forecast band ----
const HEALTH_BADGE: Record<GoalView["health"], "default" | "secondary" | "destructive" | "outline"> = {
  verde: "default", apertado: "secondary", vermelho: "destructive", "sem-projeção": "outline",
};

// The projection half, kept as hedged as the forecast lines: a band and a range,
// never "você fecha com X", and never an ETA past the 3 projected months.
function GoalProjection({ goal: g }: { goal: GoalView }) {
  if (g.done) return <p className="text-primary mt-0.5 text-xs">Meta atingida.</p>;
  const need = g.months_left > 0
    ? <>Faltam <span className="tnum">{g.months_left}</span> {g.months_left === 1 ? "mês" : "meses"} — precisa de ~<span className="tnum">{centsToBRL(g.need_per_month_cents)}</span>/mês.</>
    : <>Prazo vencido — faltam <span className="tnum">{centsToBRL(g.target_cents - g.saved_cents)}</span>.</>;
  let projection: ReactNode;
  if (g.spend_samples === 0) {
    projection = "Sem histórico de gastos para projetar o ritmo.";
  } else {
    const eta = g.reach_month
      ? <>No meio da faixa você chega em ~{monthLabel(g.reach_month)}.</>
      : <>A projeção de {g.horizon_months} meses não alcança a meta.</>;
    projection = <>Ritmo projetado: {g.health}. {eta}</>;
  }
  return <p className="text-muted-foreground mt-0.5 text-xs">{need} {projection}</p>;
}

function GoalRow({ goal: g, act }: {
  goal: GoalView; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((g.saved_cents / g.target_cents) * 100)));
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{g.label}</span>
        <div className="flex items-center gap-2">
          <Badge variant={g.done ? "default" : HEALTH_BADGE[g.health]}>{g.done ? "atingida" : g.health}</Badge>
          <button aria-label="excluir meta"
            onClick={() => confirm(`Excluir a meta “${g.label}”?`) && act(() => api(`/api/goals/${g.id}`, "DELETE"))}
            className="text-foreground/25 hover:text-destructive focus-visible:text-destructive text-lg leading-none">×</button>
        </div>
      </div>
      {/* progress: realized sobra of complete months vs the target */}
      <div className="bg-surface-1 mt-2 h-2 overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">
        <span className="tnum">{centsToBRL(g.saved_cents)}</span> de <span className="tnum">{centsToBRL(g.target_cents)}</span>
        {" · "}{g.months_counted} {g.months_counted === 1 ? "mês fechado" : "meses fechados"} desde a criação
      </p>
      <GoalProjection goal={g} />
    </div>
  );
}

function GoalsPanel({ goals, act }: {
  goals: GoalView[]; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [byMonth, setByMonth] = useState("");

  const submit = () => {
    const target_cents = brlToCents(target);
    if (!label.trim() || target_cents <= 0 || !/^\d{4}-\d{2}$/.test(byMonth)) return;
    act(() => api("/api/goals", "POST", { label: label.trim(), target_cents, by_month: byMonth }))
      .then(() => { setLabel(""); setTarget(""); setByMonth(""); setAdding(false); });
  };

  return (
    <section className="reveal border-border bg-card ring-foreground/10 mt-6 rounded-xl border ring-1">
      <div className={`flex items-center justify-between px-4 py-3 ${goals.length || adding ? "border-border border-b" : ""}`}>
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Metas</h2>
        <button onClick={() => setAdding((a) => !a)}
          className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-2.5 text-xs">+ nova meta</button>
      </div>
      {adding && (
        <div className="border-border bg-surface-1/40 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <input autoFocus placeholder="nome (ex: Reserva)" value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} flex-1`} />
          <input placeholder="alvo R$ 0,00" value={target} inputMode="decimal" onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-32 text-right`} />
          <input type="month" value={byMonth} onChange={(e) => setByMonth(e.target.value)}
            aria-label="prazo" className={`${INPUT} tnum`} />
          <button onClick={submit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-3 text-sm">add</button>
          <button onClick={() => setAdding(false)} className="text-muted-foreground text-sm">cancelar</button>
        </div>
      )}
      {goals.length > 0 && (
        <div className="divide-border flex flex-col divide-y">
          {goals.map((g) => <GoalRow key={g.id} goal={g} act={act} />)}
        </div>
      )}
    </section>
  );
}

// ---- cross-month net trend (income − committed − spent per month) ----
interface TrendMonth { month: string; income_cents: number; committed_cents: number; spent_cents: number }
function Trends() {
  const [months, setMonths] = useState<TrendMonth[] | null>(null);
  useEffect(() => { api("/api/trends").then((d) => setMonths(d.months)).catch(() => setMonths([])); }, []);
  if (!months || months.length < 2) return null; // need ≥2 months for a trend

  const rows = months.map((m) => ({ ...m, net: m.income_cents - m.committed_cents - m.spent_cents }));
  const W = 640, H = 150, PADT = 14, PADB = 22;
  const vals = rows.map((r) => r.net);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const y = (c: number) => PADT + (1 - (c - min) / span) * (H - PADT - PADB);
  const zeroY = y(0);
  const step = W / rows.length;
  const bw = step * 0.55;

  return (
    <section className="reveal border-border bg-card ring-foreground/10 mt-6 rounded-xl border ring-1">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Tendência mensal</h2>
        <span className="text-muted-foreground text-xs">entrada − comprometido − gasto</span>
      </div>
      <div className="px-4 py-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img"
          aria-label="Saldo líquido por mês">
          <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeWidth="1"
            className="text-border" vectorEffect="non-scaling-stroke" />
          {rows.map((r, i) => {
            const yv = y(r.net);
            const top = Math.min(yv, zeroY), h = Math.abs(yv - zeroY);
            const cx = i * step + step / 2;
            return (
              <g key={r.month}>
                <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, h)} rx="2"
                  fill={r.net >= 0 ? "#3ecf8e" : "#f0616d"} opacity="0.85">
                  <title>{`${r.month}: ${centsToBRL(r.net)}`}</title>
                </rect>
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-muted-foreground"
                  style={{ fontSize: "9px" }}>{r.month.slice(5)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

// ---- daily log ----
function DailyPanel({ month, spends, anomalies, act, summary, notify, cards, cardsById }: {
  month: string; spends: ApiSpend[]; anomalies: Anomaly[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
  summary: Summary; notify: (msg: string, tone?: "info" | "error") => void;
  cards: ApiCard[]; cardsById: Map<number, ApiCard>;
}) {
  const inMonth = todayISO().startsWith(month) ? todayISO() : `${month}-01`;
  const [date, setDate] = useState(inMonth);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  const [cardId, setCardId] = useState("");
  useEffect(() => setDate(todayISO().startsWith(month) ? todayISO() : `${month}-01`), [month]);

  const flagged = useMemo(() => new Map(anomalies.map((a) => [a.id, a])), [anomalies]);

  const submit = () => {
    const cents = brlToCents(amount);
    if (cents <= 0) return;
    // Close the feedback loop before the refetch: show what this spend costs
    // tomorrow's allowance. Exact arithmetic over the current summary — tomorrow
    // days_remaining drops by 1 and remaining drops by the amount, the same
    // formula summarize() uses, one day ahead.
    // ponytail: assumes no bill/income changes before midnight.
    const d = summary.days_remaining - 1;
    if (d >= 1 && date.startsWith(month)) {
      const before = Math.floor(summary.remaining_cents / d);
      const after = Math.floor((summary.remaining_cents - cents) / d);
      notify(`Mesada de amanhã: ${centsToBRL(before)} → ${centsToBRL(after)}`, "info");
    }
    // No category sent -> the server infers it from the note (src/lib/categorize.ts).
    act(() => api("/api/spends", "POST", {
      spent_on: date, amount_cents: cents, category: cat.trim() || null, note: note.trim() || null,
      card_id: cardId ? Number(cardId) : null,
    })).then(() => { setAmount(""); setNote(""); });
  };

  return (
    <section className="border-border bg-card ring-foreground/10 h-fit rounded-xl border ring-1">
      <div className="border-border border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Gasto diário</h2>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex gap-2">
          <input type="date" value={date} min={`${month}-01`} onChange={(e) => setDate(e.target.value)} className={`${INPUT} flex-1`} />
          <input placeholder="R$ 0,00" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} tnum w-28 text-right`} />
        </div>
        <div className="flex gap-2">
          <input placeholder="categoria (auto)" value={cat} list={CAT_LIST} onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} w-32`} />
          <input placeholder="nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={`${INPUT} flex-1`} />
          {/* only appears once a card exists — nothing changes for cash-only users */}
          {cards.length > 0 && (
            <select aria-label="cartão" value={cardId} onChange={(e) => setCardId(e.target.value)}
              className={`${INPUT} w-24 shrink-0`}>
              <option value="">caixa</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <button onClick={submit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center rounded-md px-3 text-sm">Lançar</button>
        </div>
      </div>
      <div className="border-border border-t">
        {spends.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-xs">Nenhum gasto lançado neste mês.</p>
        ) : (
          [...spends].reverse().map((sp) => {
            const odd = flagged.get(sp.id);
            return (
            <div key={sp.id} className="border-border hover:bg-white/[0.02] group flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
              <span className="tnum text-muted-foreground w-12 shrink-0 text-xs">{sp.spent_on.slice(8)}/{sp.spent_on.slice(5, 7)}</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {/* Editable: a wrong guess the user can only delete is a wrong guess
                    nothing learns from. Correcting it here is the training signal. */}
                <input
                  aria-label={`categoria do gasto de ${sp.spent_on}`}
                  defaultValue={sp.category}
                  list={CAT_LIST}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== sp.category) act(() => api(`/api/spends/${sp.id}`, "PATCH", { category: v }));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="border-border text-muted-foreground focus-visible:ring-ring/50 hover:border-foreground/25 h-6 w-28 shrink-0 rounded-full border bg-transparent px-2 text-[10px] outline-none focus-visible:ring-2"
                />
                {odd && (
                  <span className="text-destructive shrink-0 text-xs" role="img"
                    aria-label={`fora do padrão de ${odd.category}, mediana ${centsToBRL(odd.median_cents)}`}
                    title={`Fora do padrão de ${odd.category} — mediana ${centsToBRL(odd.median_cents)}`}>⚠</span>
                )}
                {sp.card_id != null && (
                  <span className="text-muted-foreground shrink-0 text-[10px]">{cardsById.get(sp.card_id)?.label ?? "cartão"}</span>
                )}
                <span className="min-w-0 truncate text-sm">{sp.note || "—"}</span>
              </div>
              <span className={`tnum text-sm ${odd ? "text-destructive" : ""}`}>{centsToBRL(sp.amount_cents)}</span>
              <button aria-label="excluir"
                onClick={() => confirm("Excluir este gasto?") && act(() => api(`/api/spends/${sp.id}`, "DELETE"))}
                className="text-foreground/25 hover:text-destructive focus-visible:text-destructive shrink-0 text-lg leading-none">×</button>
            </div>
            );
          })
        )}
      </div>
    </section>
  );
}
