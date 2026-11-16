// Importa para o Meridian o que a planilha CONTAS tem de Carnes e de Lista de prioridades.
// Simulação por padrão; --commit grava. Só insere (nunca apaga) e pula o que já existe,
// então rodar duas vezes não duplica.
//   node packages/db/seed-carnes.mjs            (simulação)
//   node packages/db/seed-carnes.mjs --commit
//
// As linhas estão escritas aqui de propósito: são 2 compras e 4 desejos, e uma das
// compras precisa de correção manual — a planilha não é fonte fiel dela.
import postgres from "postgres";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));

const COMMIT = process.argv.includes("--commit");
const sql = postgres(process.env.DATABASE_URL, { ssl: false, onnotice: () => {} });
const [user] = await sql`select id from users order by id limit 1`;

// aba «Carnes set2026»: 06/09/2026, peito bovino, 562 g, R$ 20,23 — confere com R$ 35,99/kg.
// aba «carne outubro 2026»: 13/10/2026, frango inteiro, R$ 22,74. A célula de quantidade diz
// «562 kg» (resto de cópia da linha de setembro): R$ 22,74 ÷ R$ 8,99/kg = 2,53 kg, e o painel
// da própria aba usa 2,53. Importado como 2.530 g.
const purchases = [
  { spent_on: "2026-09-06", cut: "Peito bovino", grams: 562, paid_cents: 2023, nota: "set/2026 — 562 g como na aba" },
  { spent_on: "2026-10-13", cut: "Frango inteiro", grams: 2530, paid_cents: 2274, nota: "out/2026 — aba diz «562 kg»; corrigido para 2,53 kg (22,74 ÷ 8,99)" },
];
// aba «Lista de prioridades». «1 peça por mês» não é número: vai como texto do «quando».
const wishes = [
  { item: "Camisa social na 44 (amorzaum)", estimate_cents: 10000, when_text: "maio" },
  { item: "Cadeiras", estimate_cents: 120000, when_text: "maio - crediário" },
  { item: "HEADSET (AMORZAUM)", estimate_cents: 25000, when_text: null },
  { item: "ROUPAS NOVAS (PRINCESA)", estimate_cents: null, when_text: "1 peça por mês" },
];

const brl = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
let nPurchases = 0, nWishes = 0;
for (const p of purchases) {
  const [cut] = await sql`select id from meat_cuts where user_id = ${user.id} and name = ${p.cut}`;
  if (!cut) throw new Error(`corte «${p.cut}» não está na tabela de referência`);
  const [dup] = await sql`select id from meat_purchases where user_id = ${user.id}
    and spent_on = ${p.spent_on} and cut_id = ${cut.id} and grams = ${p.grams} and paid_cents = ${p.paid_cents}`;
  console.log(`${dup ? "já existe " : "importa   "} compra ${p.spent_on} ${p.cut} ${p.grams} g ${brl(p.paid_cents)} — ${p.nota}`);
  if (dup) continue;
  nPurchases++;
  if (COMMIT) await sql`insert into meat_purchases (user_id, month, spent_on, cut_id, grams, paid_cents)
    values (${user.id}, ${p.spent_on.slice(0, 7)}, ${p.spent_on}, ${cut.id}, ${p.grams}, ${p.paid_cents})`;
}
let order = 0;
for (const w of wishes) {
  order++;
  const [dup] = await sql`select id from wishlist where user_id = ${user.id} and item = ${w.item}`;
  console.log(`${dup ? "já existe " : "importa   "} desejo «${w.item}» ${w.estimate_cents == null ? "sem valor" : brl(w.estimate_cents)} · ${w.when_text ?? "—"}`);
  if (dup) continue;
  nWishes++;
  if (COMMIT) await sql`insert into wishlist (user_id, item, estimate_cents, when_text, sort_order)
    values (${user.id}, ${w.item}, ${w.estimate_cents}, ${w.when_text}, ${order})`;
}
console.log(`\n${COMMIT ? "GRAVADO" : "SIMULAÇÃO (nada gravado)"}: ${nPurchases} compra(s), ${nWishes} desejo(s).`);
await sql.end();
