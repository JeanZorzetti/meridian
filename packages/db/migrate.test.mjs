// Self-check for the migration runner. Run: node scripts/migrate.test.mjs
//
// Covers the half of migrate.mjs that decides *what* to apply and in what order
// — the half that can be wrong without erroring. The half that talks to Postgres
// is verified by running `npm run db:migrate` twice against a real database (see
// AGENTS.md); a mock of pg here would only prove the mock works.
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readMigrations } from "./migrate.mjs";

/** A throwaway migrations dir. `files` is { filename: contents }. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "meridian-migrations-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const dirs = [];
const withDir = (files) => { const d = fixture(files); dirs.push(d); return d; };

// --- order is by filename, not by directory order ---
// 0010 must come after 0009, which is why versions are zero-padded and compared
// as strings: "10" < "9" lexicographically, "0010" > "0009" does not.
const ordered = readMigrations(withDir({
  "0010_j.sql": "select 1;",
  "0002_b.sql": "select 1;",
  "0001_a.sql": "select 1;",
  "0009_i.sql": "select 1;",
}));
assert.deepEqual(ordered.map((m) => m.version), ["0001", "0002", "0009", "0010"]);
assert.deepEqual(ordered.map((m) => m.name), ["a", "b", "i", "j"]);

// --- non-.sql files are ignored, not rejected ---
// A README or an editor's leftover in db/migrations must not stop a deploy.
assert.equal(readMigrations(withDir({ "0001_a.sql": "select 1;", "README.md": "# nope" })).length, 1);

// --- a filename that doesn't encode a version is refused ---
// Silently skipping it is the dangerous option: the migration looks committed
// and never runs.
assert.throws(() => readMigrations(withDir({ "add_users.sql": "select 1;" })), /nome inválido/);
assert.throws(() => readMigrations(withDir({ "001_short.sql": "select 1;" })), /nome inválido/);
assert.throws(() => readMigrations(withDir({ "0001_Maiuscula.sql": "select 1;" })), /nome inválido/);

// --- two files claiming the same version is refused ---
// Apply order between them would be arbitrary, so two environments could end up
// with different schemas while both report "up to date".
assert.throws(
  () => readMigrations(withDir({ "0001_a.sql": "select 1;", "0001_b.sql": "select 2;" })),
  /duplicada/,
);

// --- the hash is of the file's exact contents ---
// This is what makes editing an applied migration detectable; if it were
// anything looser (trimmed, normalized), an edit could slip through.
const body = "alter table users add column email text;\n";
const [hashed] = readMigrations(withDir({ "0003_email.sql": body }));
assert.equal(hashed.hash, createHash("sha256").update(body).digest("hex"));
// Whitespace counts — an edit is an edit.
const [reHashed] = readMigrations(withDir({ "0003_email.sql": body + "\n" }));
assert.notEqual(reHashed.hash, hashed.hash);

// --- transaction opt-out ---
assert.equal(readMigrations(withDir({ "0001_a.sql": "select 1;" }))[0].inTransaction, true);
assert.equal(
  readMigrations(withDir({ "0001_a.sql": "-- migrate:no-transaction\ncreate index concurrently i on t (c);" }))[0]
    .inTransaction,
  false,
);
// The marker has to be its own comment line. Mentioning it inside prose must not
// disable the transaction — that is the failure where a migration silently stops
// being atomic and nobody notices until one half of it fails.
assert.equal(
  readMigrations(withDir({ "0001_a.sql": "-- não use migrate:no-transaction aqui\nselect 1;" }))[0].inTransaction,
  true,
);

// --- the real db/migrations directory parses ---
// Catches a badly named migration at test time instead of at deploy time.
const real = readMigrations();
assert.ok(real.length >= 1, "db/migrations está vazio");
assert.equal(real[0].version, "0001");

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`migrate.test.mjs ✓  (${real.length} migração(ões) reais parseadas)`);
