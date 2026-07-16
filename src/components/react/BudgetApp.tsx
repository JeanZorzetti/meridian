import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { brlToCents, centsToBRL, type Summary } from "@/lib/budget";
import { CATEGORIES } from "@/lib/categorize";
import type { Anomaly, MonthForecast, Projection } from "@/lib/insights";

// ---- types (match the /api/month JSON shape; db.ts is server-only) ----
interface ApiIncome { id: number; label: string; amount_cents: number }
interface ApiBill {
  id: number; name: string; category: string; planned_cents: number;
  actual_cents: number | null; paid: boolean; pay_method: string | null;
  installment_current: number | null; installment_total: number | null;
  due_day: number | null; recurring: boolean; sort_order: number;
}
interface ApiSpend { id: number; spent_on: string; amount_cents: number; category: string; note: string | null }
// `forecast` is the months ahead; today only `lines` renders it. It's in the
// payload so a panel can use the numbers without a second roundtrip.
interface ApiInsights {
  projection: Projection | null; anomalies: Anomaly[];
  forecast: MonthForecast[]; lines: string[];
}
interface MonthData {
  month: string; incomes: ApiIncome[]; bills: ApiBill[]; spends: ApiSpend[];
  summary: Summary; insights: ApiInsights;
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
async function api(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
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
  const [toast, setToast] = useState<string | null>(null);
  const first = useRef(true);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
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
          <form method="POST" action="/api/logout">
            <button className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-xs">Sair</button>
          </form>
        </div>
      </header>

      {empty ? (
        <EmptyMonth month={month} onRollover={() => act(() => api("/api/rollover", "POST", { from: shiftMonth(month, -1), to: month }))}
          onSeedIncome={() => act(() => api("/api/income", "POST", { month, amount_cents: 0 }))} busy={busy} />
      ) : (
        <>
          {/* hero — the signature number */}
          <section className="border-border bg-card ring-foreground/10 relative overflow-hidden rounded-xl border p-6 ring-1">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
              <div>
                <p className="eyebrow">Você pode gastar hoje</p>
                <p className={`tnum mt-2 text-5xl font-semibold tracking-[-0.03em] sm:text-6xl ${s.per_day_cents < 0 ? "text-destructive" : "text-primary"}`}>
                  {centsToBRL(s.per_day_cents)}
                </p>
                <p className="text-muted-foreground mt-3 text-sm">
                  <span className="tnum">{s.days_remaining}</span> {s.days_remaining === 1 ? "dia restante" : "dias restantes"} ·
                  baseline <span className="tnum">{centsToBRL(s.per_day_start_cents)}</span>/dia
                </p>
              </div>
              <div className="h-36 sm:h-40">
                <Burndown summary={s} month={month} projection={ins.projection} />
              </div>
            </div>
            <div className="border-border mt-6 grid grid-cols-2 rounded-lg border sm:grid-cols-5">
              <Metric label="Entrada" value={centsToBRL(s.income_cents)} />
              <Metric label="Comprometido" value={centsToBRL(s.committed_cents)} />
              <Metric label="Sobra" value={centsToBRL(s.sobra_cents)} tone={s.sobra_cents < 0 ? "rose" : "mint"} />
              <Metric label="Gasto no mês" value={centsToBRL(s.spent_cents)} />
              <Metric label="A pagar" value={centsToBRL(s.unpaid_cents)} tone={s.unpaid_cents > 0 ? "rose" : undefined} />
            </div>
            <InsightsPanel lines={ins.lines} />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <BillsPanel month={month} groups={groups} incomes={data.incomes} act={act} />
            <div className="flex flex-col gap-6">
              <DailyPanel month={month} spends={data.spends} anomalies={ins.anomalies} act={act} />
              <CategoryBreakdown data={s.by_category} />
            </div>
          </div>
          <Trends />
        </>
      )}
      {busy && <div className="text-muted-foreground fixed bottom-4 right-4 text-xs">salvando…</div>}
      {toast && (
        <div role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg">
          <button onClick={() => setToast(null)} className="flex items-center gap-2" aria-label="fechar aviso">
            {toast} <span className="text-destructive/60">×</span>
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
function BillsPanel({ month, groups, incomes, act }: {
  month: string; groups: [string, ApiBill[]][]; incomes: ApiIncome[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="border-border bg-card ring-foreground/10 rounded-xl border ring-1">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Contas</h2>
        <button onClick={() => setAdding((a) => !a)}
          className="border-border hover:bg-accent inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs">
          + nova conta
        </button>
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
            {sorted.map((b) => <BillRow key={b.id} bill={b} month={month} act={act} />)}
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

function BillRow({ bill: b, month, act }: {
  bill: ApiBill; month: string; act: (fn: () => Promise<unknown>) => Promise<void>;
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

      {open && <BillEditor bill={b} act={act} />}
    </div>
  );
}

// ---- expanded editor: everything secondary lives here, not in the row ----
function BillEditor({ bill: b, act }: {
  bill: ApiBill; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const patch = (body: Record<string, unknown>) => act(() => api(`/api/bills/${b.id}`, "PATCH", body));
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
      <Field label="planejado">
        <MoneyInput cents={b.planned_cents} className="w-full"
          onCommit={(c) => patch({ planned_cents: c })} />
      </Field>
      <Field label="real (conciliado)">
        <MoneyInput cents={b.actual_cents} placeholder="não conciliado" className="w-full"
          onCommit={(c) => patch({ actual_cents: c })} />
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
  const submit = () => {
    if (!name.trim()) return;
    // No category sent -> the server infers it from the name (src/lib/categorize.ts).
    act(() => api("/api/bills", "POST", {
      month, name: name.trim(), category: cat.trim() || null, planned_cents: brlToCents(value),
      due_day: day.trim() ? Math.min(31, Math.max(1, Math.trunc(Number(day)))) : null,
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
function CategoryBreakdown({ data }: { data: { category: string; cents: number }[] }) {
  const total = data.reduce((a, c) => a + c.cents, 0);
  if (total <= 0) return null;
  const max = data[0].cents; // data is sorted desc by summarize()
  return (
    <section className="border-border bg-card ring-foreground/10 h-fit rounded-xl border ring-1">
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
              <div className="h-full rounded-full"
                style={{ width: `${(c.cents / max) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
            </div>
          </div>
        ))}
      </div>
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
    <section className="border-border bg-card ring-foreground/10 mt-6 rounded-xl border ring-1">
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
function DailyPanel({ month, spends, anomalies, act }: {
  month: string; spends: ApiSpend[]; anomalies: Anomaly[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const inMonth = todayISO().startsWith(month) ? todayISO() : `${month}-01`;
  const [date, setDate] = useState(inMonth);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => setDate(todayISO().startsWith(month) ? todayISO() : `${month}-01`), [month]);

  const flagged = useMemo(() => new Map(anomalies.map((a) => [a.id, a])), [anomalies]);

  const submit = () => {
    const cents = brlToCents(amount);
    if (cents <= 0) return;
    // No category sent -> the server infers it from the note (src/lib/categorize.ts).
    act(() => api("/api/spends", "POST", {
      spent_on: date, amount_cents: cents, category: cat.trim() || null, note: note.trim() || null,
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
