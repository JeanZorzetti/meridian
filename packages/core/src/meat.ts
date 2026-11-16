// Carnes — o controle de compras de carne do mês. Pura, centavos e gramas inteiros,
// sem I/O: a mesma regra de budget.ts. As telas não refazem conta; leem daqui.
//
// A planilha mistura kg e g e guarda o valor em reais com vírgula; aqui o peso é
// sempre em gramas e o preço sempre em centavos por kg.

export interface MeatCut {
  id: number;
  category: string;
  name: string;
  ref_price_cents: number; // último preço por kg conhecido (centavos)
}
export interface MeatPurchase {
  id: number;
  spent_on: string; // 'YYYY-MM-DD'
  cut_id: number;
  grams: number;
  paid_cents: number;
}
export interface MeatTarget {
  cut_id: number;
  grams: number;
}

/** Preço efetivo por kg (centavos) de uma compra: valor ÷ kg. null sem peso. */
export function perKgCents(paid_cents: number, grams: number): number | null {
  return grams > 0 ? Math.round((paid_cents * 1000) / grams) : null;
}

export interface MeatTotals {
  paid_cents: number; // TOTAL GASTO
  grams: number; // TOTAL COMPRADO
  avg_per_kg_cents: number | null; // PREÇO MÉDIO/KG = gasto ÷ kg
  budget_cents: number; // orçamento do mês (a conta «Carnes»)
  balance_cents: number; // SALDO ORÇAMENTÁRIO = orçamento − gasto
}

export function meatTotals(purchases: MeatPurchase[], budget_cents: number): MeatTotals {
  const paid_cents = purchases.reduce((a, p) => a + p.paid_cents, 0);
  const grams = purchases.reduce((a, p) => a + p.grams, 0);
  return {
    paid_cents,
    grams,
    avg_per_kg_cents: perKgCents(paid_cents, grams),
    budget_cents,
    balance_cents: budget_cents - paid_cents,
  };
}

/** Preço de referência de um corte no mês: o preço efetivo da última compra dele
 *  (data, depois id); sem compra, o último preço da tabela. */
export function refPriceCents(cut: MeatCut, purchases: MeatPurchase[]): number {
  let last: MeatPurchase | null = null;
  for (const p of purchases) {
    if (p.cut_id !== cut.id || p.grams <= 0) continue;
    if (!last || p.spent_on > last.spent_on || (p.spent_on === last.spent_on && p.id > last.id)) last = p;
  }
  return (last && perKgCents(last.paid_cents, last.grams)) ?? cut.ref_price_cents;
}

export interface CutRow {
  cut_id: number;
  category: string;
  name: string;
  ref_price_cents: number;
  realized_grams: number;
  target_grams: number;
  balance_grams: number; // meta − realizado: o que ainda falta comprar (negativo = passou)
  budget_cents: number; // realizado × preço de referência
}

/** O painel gerencial por corte. Só entram cortes com compra ou meta no mês. */
export function cutPanel(
  cuts: MeatCut[], purchases: MeatPurchase[], targets: MeatTarget[],
): { rows: CutRow[]; total: { realized_grams: number; target_grams: number; balance_grams: number; budget_cents: number } } {
  const rows: CutRow[] = [];
  for (const c of cuts) {
    const realized_grams = purchases.filter((p) => p.cut_id === c.id).reduce((a, p) => a + p.grams, 0);
    const target_grams = targets.find((t) => t.cut_id === c.id)?.grams ?? 0;
    if (realized_grams === 0 && target_grams === 0) continue;
    const ref = refPriceCents(c, purchases);
    rows.push({
      cut_id: c.id, category: c.category, name: c.name, ref_price_cents: ref,
      realized_grams, target_grams, balance_grams: target_grams - realized_grams,
      budget_cents: Math.round((realized_grams * ref) / 1000),
    });
  }
  const sum = (f: (r: CutRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    rows,
    total: {
      realized_grams: sum((r) => r.realized_grams),
      target_grams: sum((r) => r.target_grams),
      balance_grams: sum((r) => r.balance_grams),
      budget_cents: sum((r) => r.budget_cents),
    },
  };
}

/** O orçamento de carnes do mês: a conta «Carnes»/«Carne» (valor real se conciliado,
 *  senão o planejado). 0 quando o mês não tem essa conta. */
export function meatBudgetCents(bills: { name: string; planned_cents: number; actual_cents: number | null }[]): number {
  const b = bills.find((x) => /^carnes?\b/i.test(x.name.trim()));
  return b ? (b.actual_cents ?? b.planned_cents) : 0;
}

/** «2,53 kg» / «562 g» — gramas inteiras para o texto da tela. */
export function formatGrams(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
}

/** Quantidade digitada + unidade → gramas inteiras. «kg» aceita vírgula. */
export function toGrams(qty: number, unit: "kg" | "g"): number {
  return Math.round(unit === "kg" ? qty * 1000 : qty);
}
