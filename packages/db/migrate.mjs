// Versioned schema migrations. Run: npm run db:migrate  (status: npm run db:migrate -- --status)
//
// Why this exists: the EasyPanel deploy does not touch the database. Before this
// script the schema lived in one idempotent db/schema.sql that somebody had to
// remember to run by hand — and when nobody did, the site answered 200 while
// /admin broke on a column that only existed locally. That failure is invisible
// from the outside, which is what makes it dangerous.
//
// The contract:
//   - db/migrations/NNNN_name.sql, applied in filename order, each exactly once.
//   - Every applied file is recorded in schema_migrations with a hash of its
//     contents. Editing a migration that already ran is refused, loudly: the
//     database cannot be un-migrated by rewriting history, and a silent hash
//     drift means two environments have quietly stopped being the same schema.
//   - Each migration runs inside a transaction, so a failure halfway leaves the
//     database on the previous version rather than in between. A migration that
//     genuinely cannot run in one (create index concurrently, alter type ... add
//     value on older servers) opts out with `-- migrate:no-transaction` on any
//     line, and then owns its own atomicity.
//   - A session-level advisory lock serializes concurrent runners, so two
//     containers booting at once cannot both apply 0007.
//
// Safe to run on every deploy, and that is exactly how it runs: the root
// `start` script calls this before handing over to the server, so every boot of
// the container migrates first. With nothing pending it costs one round trip
// and changes nothing. MIGRATE_SKIP=1 is the escape hatch — see main().
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "migrations");

// Any constant works as long as nothing else in this database picks the same
// one; pg_advisory_lock's namespace is the whole cluster.
const LOCK_KEY = 8_675_309_001;

const FILE_RE = /^(\d{4})_([a-z0-9_-]+)\.sql$/;

/** Migrations on disk, in apply order. Rejects a filename that doesn't encode a
 *  version, and a duplicated version — either one makes "apply order" ambiguous,
 *  and ambiguity here means two environments can end up with different schemas
 *  while both claim to be up to date.
 *  Exported for scripts/migrate.test.mjs — the half of this file that has rules
 *  worth testing is the half that never touches a database. */
export function readMigrations(dir = DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Map();
  return files.map((file) => {
    const m = file.match(FILE_RE);
    if (!m) {
      throw new Error(
        `migração com nome inválido: ${file}\n` +
          `  esperado: NNNN_nome_em_minusculas.sql  (ex: 0002_contas_de_usuario.sql)`,
      );
    }
    const [, version, name] = m;
    if (seen.has(version)) {
      throw new Error(`versão duplicada ${version}: ${seen.get(version)} e ${file}`);
    }
    seen.set(version, file);

    const sql = readFileSync(join(dir, file), "utf8");
    return {
      version,
      name,
      file,
      sql,
      hash: createHash("sha256").update(sql).digest("hex"),
      // Opt-out marker, not auto-detection: a heuristic that scanned for
      // "concurrently" would also match the word inside a comment, and silently
      // dropping the transaction is the wrong way to be wrong.
      inTransaction: !/^\s*--\s*migrate:no-transaction\s*$/m.test(sql),
    };
  });
}

async function ensureTable(sql) {
  await sql`
    create table if not exists schema_migrations (
      version    text primary key,
      name       text not null,
      hash       text not null,
      applied_at timestamptz not null default now()
    )`;
}

async function main() {
  // The container's start command runs this before the server, so a migration
  // that cannot run takes the whole site down with it. That is the right
  // default — a server talking to a schema it does not expect fails invisibly,
  // and invisible is the failure mode this script exists to kill — but it
  // leaves whoever is watching a crash-looping deploy with no way out that
  // doesn't require a commit. This is that way out: set MIGRATE_SKIP=1 in the
  // environment, get the site back up, fix the migration, unset it.
  if (process.env.MIGRATE_SKIP === "1") {
    console.log("MIGRATE_SKIP=1 — migrações puladas nesta inicialização");
    return;
  }

  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL não definido (no .env local, ou nas variáveis do ambiente)");
  }

  const statusOnly = process.argv.includes("--status");
  const migrations = readMigrations();

  const sql = postgres(DATABASE_URL, { ssl: false, onnotice: () => {} });
  let locked = false;
  try {
    await ensureTable(sql);

    if (statusOnly) {
      const applied = new Map(
        (await sql`select version, hash, applied_at from schema_migrations`).map((r) => [r.version, r]),
      );
      console.log(`${migrations.length} migração(ões) em db/migrations\n`);
      for (const m of migrations) {
        const a = applied.get(m.version);
        if (!a) console.log(`  pendente   ${m.file}`);
        else if (a.hash !== m.hash) console.log(`  ALTERADA   ${m.file}  ← arquivo mudou depois de aplicado`);
        else console.log(`  aplicada   ${m.file}  (${a.applied_at.toISOString().slice(0, 19).replace("T", " ")})`);
      }
      // A row with no file is not an error here: rolling back the code to an
      // older commit is a normal thing to do, and the database keeping a newer
      // migration is exactly what should happen.
      for (const [version, a] of applied) {
        if (!migrations.some((m) => m.version === version)) {
          console.log(`  no banco   ${version}_${a.name}.sql  ← aplicada, sem arquivo neste commit`);
        }
      }
      return;
    }

    // Session-level, not xact-level: the lock has to outlive each migration's
    // own transaction and cover the whole run.
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    locked = true;

    const applied = new Map(
      (await sql`select version, hash from schema_migrations`).map((r) => [r.version, r.hash]),
    );

    // Drift check runs over everything before anything is applied: finding out
    // at 0009 that 0003 was edited is worse than not starting at all.
    for (const m of migrations) {
      const knownHash = applied.get(m.version);
      if (knownHash && knownHash !== m.hash) {
        throw new Error(
          `${m.file} já foi aplicada neste banco, mas o arquivo mudou desde então.\n` +
            `  Uma migração aplicada é história — editá-la não desfaz o que já rodou no banco.\n` +
            `  Escreva uma migração nova com a correção e deixe esta como está.`,
        );
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version));
    if (pending.length === 0) {
      console.log(`nada pendente — ${migrations.length} migração(ões) já aplicada(s)`);
      return;
    }

    for (const m of pending) {
      const started = Date.now();
      const record = (tx) =>
        tx`insert into schema_migrations (version, name, hash)
           values (${m.version}, ${m.name}, ${m.hash})`;

      if (m.inTransaction) {
        await sql.begin(async (tx) => {
          await tx.unsafe(m.sql);
          await record(tx);
        });
      } else {
        // Outside a transaction the two steps can't be atomic. Order matters:
        // apply first, record second. Crashing between them leaves the migration
        // pending and it gets retried — recoverable if it's written to tolerate a
        // partial re-run, which is the price of opting out. Recording first would
        // instead mark an unapplied migration as done, and nothing would ever fix
        // that on its own.
        await sql.unsafe(m.sql);
        await record(sql);
      }
      console.log(`  ✓ ${m.file}${m.inTransaction ? "" : " (sem transação)"}  ${Date.now() - started}ms`);
    }
    console.log(`\n${pending.length} migração(ões) aplicada(s)`);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end();
  }
}

// Only when run as a command. The test imports readMigrations() from here and
// must not open a connection as a side effect of that import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\nmigração falhou: ${e.message}`);
    process.exit(1);
  });
}
