// Seed all months from docs/CONTAS.xlsx into Postgres.
// Dry-run by default (prints parsed numbers). Pass --commit to write.
//   node --env-file=.env scripts/seed-xlsx.mjs           (dry-run)
//   node --env-file=.env scripts/seed-xlsx.mjs --commit  (writes; replaces each month)
//
// The .xlsx column layout varies month to month, so columns are detected by
// content: the bills' name column = leftmost "CARTÕES" cell; income = the cell
// right of the "Entrada" label. Money cells are native numbers → round(v*100).
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { categorize } from "@meridian/core/categorize";

// packages/db -> repo root: docs/ lives there, not inside this package.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const XLSX = join(ROOT, "docs", "CONTAS.xlsx");
const COMMIT = process.argv.includes("--commit");

// self-extract the needed XML parts of the .xlsx (a zip) into a temp dir
const EXTRACT_ROOT = mkdtempSync(join(tmpdir(), "meridian-xlsx-"));
execSync(`unzip -o -q "${XLSX}" "xl/sharedStrings.xml" "xl/worksheets/*.xml" -d "${EXTRACT_ROOT}"`, { stdio: "ignore" });
const EXTRACT = join(EXTRACT_ROOT, "xl");

// name -> physical worksheet file (from xl/_rels/workbook.xml.rels)
const MONTHS = [
  { key: "2025-11", label: "Novembro",  monthly: 1,  daily: null },
  { key: "2025-12", label: "Dezembro",  monthly: 3,  daily: null },
  { key: "2026-01", label: "Janeiro",   monthly: 6,  daily: 9 },
  { key: "2026-02", label: "Fevereiro", monthly: 10, daily: 11 },
  { key: "2026-03", label: "Março",     monthly: 13, daily: 14 },
  { key: "2026-04", label: "Abril",     monthly: 15, daily: 17 },
  { key: "2026-05", label: "Maio",      monthly: 18, daily: 20 },
  { key: "2026-06", label: "Junho",     monthly: 21, daily: 22 },
  { key: "2026-07", label: "Julho",     monthly: 23, daily: 24 },
];

// ---------- xlsx primitives ----------
function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}
function parseSharedStrings(xml) {
  const out = [];
  const si = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml))) {
    let text = "";
    const t = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = t.exec(m[1]))) text += tm[1];
    out.push(decodeXml(text));
  }
  return out;
}
const colToNum = (s) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

function parseSheet(xml, strings) {
  const cells = new Map(); // "col,row" -> { col, row, num, val }
  const cRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cRe.exec(xml))) {
    const [, letters, rowStr, attrs, inner] = m;
    if (inner == null || inner === "") continue; // empty cell
    const t = /t="([^"]+)"/.exec(attrs)?.[1];
    let num = false, val;
    if (t === "s") {
      const i = /<v>(\d+)<\/v>/.exec(inner);
      val = i ? strings[+i[1]] ?? "" : "";
    } else if (t === "inlineStr") {
      val = decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "");
    } else if (t === "str") {
      val = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (v == null || Number.isNaN(parseFloat(v))) continue;
      num = true; val = parseFloat(v);
    }
    const col = colToNum(letters);
    cells.set(`${col},${+rowStr}`, { col, row: +rowStr, num, val });
  }
  return cells;
}
const get = (cells, col, row) => cells.get(`${col},${row}`);

// ---------- semantics ----------
const SKIP = /^(cart[õoóô]es|total|sobra|entrada|pode gastar|d[ií]vidas|pod)\b/i;

function parseMonth(cells) {
  const all = [...cells.values()];
  // income: cell to the right of an "Entrada" label
  let income = 0;
  const entrada = all.find((c) => !c.num && /^\s*entrada\s*$/i.test(String(c.val)));
  if (entrada) {
    const v = get(cells, entrada.col + 1, entrada.row);
    if (v?.num) income = Math.round(v.val * 100);
  }
  // name column = leftmost "CARTÕES" cell (also appears as a summary label further right)
  const carts = all.filter((c) => !c.num && /^\s*cart[õoóô]es\s*$/i.test(String(c.val)));
  if (!carts.length) return { income, bills: [] };
  const nameCol = Math.min(...carts.map((c) => c.col));
  const valueCol = nameCol + 1, actualCol = nameCol + 2;

  const rows = [...new Set(all.filter((c) => c.col === nameCol).map((c) => c.row))].sort((a, b) => a - b);
  const bills = [];
  let sort = 0;
  for (const r of rows) {
    const nc = get(cells, nameCol, r);
    if (!nc || nc.num) continue;
    let name = String(nc.val).trim();
    if (!name || SKIP.test(name)) continue;
    const pc = get(cells, valueCol, r);
    if (!pc || !pc.num) continue;
    const planned = Math.round(pc.val * 100);
    if (planned === 0) continue;

    const ac = get(cells, actualCol, r);
    let actual = null, paid = false, pay_method = null;
    if (ac) {
      if (ac.num) { if (ac.val > 0) actual = Math.round(ac.val * 100); }
      else {
        const d = String(ac.val);
        if (/pago/i.test(d)) paid = true;
        else if (/caixa/i.test(d)) pay_method = "caixa";
        else if (/cart/i.test(d)) pay_method = "cartão";
      }
    }
    // installment "N/M" only when it's a valid ratio (N ≤ M); "10/6" is a date/note, not a parcela
    let ic = null, it = null;
    const im = name.match(/(\d+)\s*\/\s*(\d+)/);
    if (im && +im[1] <= +im[2] && +im[2] <= 60) {
      ic = +im[1]; it = +im[2];
      name = name.replace(im[0], "").replace(/\s{2,}/g, " ").trim();
    }
    const dm = name.match(/dia\s+(\d{1,2})/i);
    bills.push({
      name, category: categorize(name), planned_cents: planned, actual_cents: actual,
      paid, pay_method, installment_current: ic, installment_total: it,
      due_day: dm ? +dm[1] : null, recurring: true, sort_order: sort++,
    });
  }
  return { income, bills };
}

const serialDay = (serial) => new Date(Math.round((serial - 25569) * 86400000)).getUTCDate();

function parseDaily(cells, monthKey) {
  const spends = [];
  for (const c of cells.values()) {
    if (!c.num || c.val < 40000 || c.val > 60000) continue; // date serial
    const g = get(cells, c.col + 1, c.row); // gasto is the next column
    if (!g?.num || g.val <= 0 || g.val >= 40000) continue;
    spends.push({ spent_on: `${monthKey}-${String(serialDay(c.val)).padStart(2, "0")}`, amount_cents: Math.round(g.val * 100) });
  }
  return spends;
}

// ---------- run ----------
const strings = parseSharedStrings(readFileSync(join(EXTRACT, "sharedStrings.xml"), "utf8"));
const sheetCells = (n) => parseSheet(readFileSync(join(EXTRACT, "worksheets", `sheet${n}.xml`), "utf8"), strings);

const parsed = MONTHS.map((mo) => {
  const { income, bills } = parseMonth(sheetCells(mo.monthly));
  const spends = mo.daily ? parseDaily(sheetCells(mo.daily), mo.key) : [];
  const committed = bills.reduce((a, b) => a + (b.actual_cents ?? b.planned_cents), 0);
  const spent = spends.reduce((a, s) => a + s.amount_cents, 0);
  return { ...mo, income, bills, spends, committed, spent };
});
rmSync(EXTRACT_ROOT, { recursive: true, force: true });

console.log(`\n${COMMIT ? "COMMIT" : "DRY-RUN"} — docs/CONTAS.xlsx\n`);
console.log("mês       entrada   comprometido  sobra      contas  gastos  Σgasto");
for (const p of parsed) {
  console.log(
    `${p.key}  ${(p.income / 100).toFixed(2).padStart(8)}  ${(p.committed / 100).toFixed(2).padStart(11)}  ` +
    `${((p.income - p.committed) / 100).toFixed(2).padStart(9)}  ${String(p.bills.length).padStart(5)}  ` +
    `${String(p.spends.length).padStart(5)}  ${(p.spent / 100).toFixed(2).padStart(8)}`,
  );
}

const dbg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
if (dbg) {
  const p = parsed.find((x) => x.key === dbg);
  console.log(`\n--- ${dbg} bills ---`);
  for (const b of p.bills) {
    const inst = b.installment_total ? ` [${b.installment_current}/${b.installment_total}]` : "";
    const st = b.paid ? " PAGO" : b.pay_method ? ` ${b.pay_method}` : "";
    console.log(`  ${b.category.padEnd(14)} ${b.name}${inst}${st}  = ${((b.actual_cents ?? b.planned_cents) / 100).toFixed(2)}`);
  }
}

if (!COMMIT) {
  console.log("\n(dry-run — nada gravado. Rode com --commit para gravar.)");
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: false, onnotice: () => {} });
try {
  const [user] = await sql`select id from users where username = ${process.env.ADMIN_USER}`;
  if (!user) throw new Error("admin não existe — rode npm run db:init antes");
  for (const p of parsed) {
    await sql`delete from incomes where user_id = ${user.id} and month = ${p.key}`;
    await sql`delete from bills where user_id = ${user.id} and month = ${p.key}`;
    await sql`delete from daily_spends where user_id = ${user.id} and month = ${p.key}`;
    if (p.income > 0) {
      await sql`insert into incomes (user_id, month, label, amount_cents) values (${user.id}, ${p.key}, 'Entrada', ${p.income})`;
    }
    for (const b of p.bills) await sql`insert into bills ${sql({ user_id: user.id, month: p.key, ...b })}`;
    for (const s of p.spends) {
      await sql`insert into daily_spends (user_id, month, spent_on, amount_cents) values (${user.id}, ${p.key}, ${s.spent_on}, ${s.amount_cents})`;
    }
  }
  console.log(`\n✓ ${parsed.length} meses gravados.`);
} finally {
  await sql.end();
}
