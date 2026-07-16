// One-shot, idempotent DB init + seed. Run: npm run db:init
//   (= node --env-file=.env scripts/init-db.mjs)
// Creates schema, the admin user (from .env), and seeds month 2026-07 from the
// two Sheets CSVs in docs/. Re-running is safe: schema uses IF NOT EXISTS, the
// user upsert is ON CONFLICT DO NOTHING, and the seed skips if 2026-07 exists.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync, randomBytes } from "node:crypto";
import postgres from "postgres";
import { categorize } from "../src/lib/categorize.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const SEED_MONTH = "2026-07";

// --- tiny helpers (brlToCents mirrors src/lib/budget.ts; scrypt mirrors src/lib/auth.ts) ---
function brlToCents(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === "") return 0;
  const negative = s.includes("-");
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return 0;
  const value = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(value)) return 0;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- parse the monthly sheet into incomes + bills ---
function parseMonthly(text) {
  const rows = parseCSV(text);
  let income = 0;
  const bills = [];
  let sort = 0;
  for (const r of rows) {
    // right-hand summary block: col F label / col G value
    if ((r[5] || "").trim().toLowerCase() === "entrada") income = brlToCents(r[6]);

    let name = (r[1] || "").trim();
    const plannedRaw = r[2] || "";
    const planned = brlToCents(plannedRaw);
    if (!name || planned === 0) continue;
    if (name === "CARTÕES" || name.toUpperCase() === "TOTAL") continue; // ambiguous aggregate / footer

    // installment "N/M" -> strip from name
    let installment_current = null, installment_total = null;
    const im = name.match(/(\d+)\s*\/\s*(\d+)/);
    if (im) {
      installment_current = +im[1];
      installment_total = +im[2];
      name = name.replace(im[0], "").replace(/\s{2,}/g, " ").trim();
    }
    // due day "dia 21"
    const dm = name.match(/dia\s+(\d{1,2})/i);
    const due_day = dm ? +dm[1] : null;

    // col D: money (actual) or a status word
    const d = (r[3] || "").trim();
    let actual = null, paid = false, pay_method = null;
    if (/pago/i.test(d)) paid = true;
    else if (/caixa/i.test(d)) pay_method = "caixa";
    else if (/cart/i.test(d)) pay_method = "cartão";
    // negative col-D values are sheet deltas ("quanto falta"), not the amount paid — ignore
    else if (/r\$|,/.test(d)) { const c = brlToCents(d); if (c > 0) actual = c; }

    bills.push({
      name, category: categorize(name), planned_cents: planned, actual_cents: actual,
      paid, pay_method, installment_current, installment_total, due_day,
      recurring: true, sort_order: sort++,
    });
  }
  return { income, bills };
}

// --- parse the daily sheet: a date cell immediately followed by a money cell is that day's spend ---
function parseDaily(text) {
  const rows = parseCSV(text);
  const spends = [];
  const dateRe = /^\s*(\d{1,2})\/(\d{1,2})\s*$/;
  for (const r of rows) {
    for (let i = 0; i < r.length - 1; i++) {
      const m = (r[i] || "").match(dateRe);
      if (!m) continue;
      const cents = brlToCents(r[i + 1]);
      if (cents > 0) spends.push({ day: +m[1], amount_cents: cents });
    }
  }
  return spends;
}

async function main() {
  const { DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL) throw new Error("DATABASE_URL não definido (.env)");
  if (!ADMIN_USER || !ADMIN_PASSWORD) throw new Error("ADMIN_USER / ADMIN_PASSWORD não definidos (.env)");

  const sql = postgres(DATABASE_URL, { ssl: false, onnotice: () => {} });
  try {
    // 1. schema
    await sql.unsafe(readFileSync(join(root, "db", "schema.sql"), "utf8"));
    console.log("schema ✓");

    // 2. admin user (re-running syncs the password to whatever is in .env)
    await sql`insert into users (username, password_hash)
              values (${ADMIN_USER}, ${hashPassword(ADMIN_PASSWORD)})
              on conflict (username) do update set password_hash = excluded.password_hash`;
    const [user] = await sql`select id from users where username = ${ADMIN_USER}`;
    console.log(`admin '${ADMIN_USER}' ✓ (id ${user.id})`);

    if (process.argv.includes("--reset")) {
      await sql`delete from incomes where user_id = ${user.id} and month = ${SEED_MONTH}`;
      await sql`delete from bills where user_id = ${user.id} and month = ${SEED_MONTH}`;
      await sql`delete from daily_spends where user_id = ${user.id} and month = ${SEED_MONTH}`;
      console.log(`reset ${SEED_MONTH} ✓`);
    }

    // 3. seed month (skip if already present)
    const [{ count }] = await sql`select count(*)::int from bills where user_id = ${user.id} and month = ${SEED_MONTH}`;
    if (count > 0) {
      console.log(`seed pulado — ${SEED_MONTH} já tem ${count} contas`);
      return;
    }

    const { income, bills } = parseMonthly(readFileSync(join(root, "docs", "Julho", "CONTAS - JULHO 2026.csv"), "utf8"));
    const spends = parseDaily(readFileSync(join(root, "docs", "Julho", "CONTAS - diário julho 2026.csv"), "utf8"));

    await sql`insert into incomes (user_id, month, label, amount_cents)
              values (${user.id}, ${SEED_MONTH}, 'Entrada', ${income})`;

    for (const b of bills) {
      await sql`insert into bills ${sql({ user_id: user.id, month: SEED_MONTH, ...b })}`;
    }
    for (const s of spends) {
      const spent_on = `${SEED_MONTH}-${String(s.day).padStart(2, "0")}`;
      await sql`insert into daily_spends (user_id, month, spent_on, amount_cents)
                values (${user.id}, ${SEED_MONTH}, ${spent_on}, ${s.amount_cents})`;
    }

    const committed = bills.reduce((a, b) => a + (b.actual_cents ?? b.planned_cents), 0);
    console.log(`\nseed ${SEED_MONTH} ✓`);
    console.log(`  entrada:     ${(income / 100).toFixed(2)}`);
    console.log(`  contas:      ${bills.length} (comprometido recomputado: ${(committed / 100).toFixed(2)})`);
    console.log(`  sobra:       ${((income - committed) / 100).toFixed(2)}`);
    console.log(`  gastos diários semeados: ${spends.length} (dias ${spends.map((s) => s.day).join(", ")})`);
    console.log(`\n  nota: total recomputado pode divergir do total manual da planilha — é a correção.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
