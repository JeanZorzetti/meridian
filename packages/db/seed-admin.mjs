// Bootstrap the first user. Run: npm run db:seed  (schema first: npm run db:migrate)
//
// Split out of the old scripts/init-db.mjs, which did three unrelated jobs in one
// command: apply the schema, create the admin, and import a month from two CSVs
// in docs/Julho/. Those CSVs no longer exist, so on a fresh database the script
// created the schema and the admin and *then* died on ENOENT — the seed half was
// unreachable, and the schema half is now scripts/migrate.mjs's job. Importing
// real months is scripts/seed-xlsx.mjs, which covers nine of them instead of one.
//
// What's left is this: one user, from .env, so somebody can log in. Re-running
// resets that user's password to whatever ADMIN_PASSWORD currently says — which
// is the recovery path when it's forgotten, and the reason this is a local
// command and not something the deploy runs.
import { scryptSync, randomBytes } from "node:crypto";
import postgres from "postgres";

function hashPassword(pw) {
  // Mirrors hashPassword() in src/lib/auth.ts — same "salt:hash" scrypt format
  // verifyPassword() expects. Duplicated rather than imported so this script
  // stays runnable as plain node, with no TypeScript loader.
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

async function main() {
  const { DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL) throw new Error("DATABASE_URL não definido (.env)");
  if (!ADMIN_USER || !ADMIN_PASSWORD) throw new Error("ADMIN_USER / ADMIN_PASSWORD não definidos (.env)");

  const sql = postgres(DATABASE_URL, { ssl: false, onnotice: () => {} });
  try {
    const [{ exists }] = await sql`
      select exists (select 1 from information_schema.tables
                     where table_schema = 'public' and table_name = 'users') as exists`;
    if (!exists) throw new Error("tabela `users` não existe — rode `npm run db:migrate` primeiro");

    const [{ existed }] = await sql`
      select exists (select 1 from users where username = ${ADMIN_USER}) as existed`;

    await sql`insert into users (username, password_hash)
              values (${ADMIN_USER}, ${hashPassword(ADMIN_PASSWORD)})
              on conflict (username) do update set password_hash = excluded.password_hash`;
    const [user] = await sql`select id from users where username = ${ADMIN_USER}`;

    console.log(
      existed
        ? `usuário '${ADMIN_USER}' já existia (id ${user.id}) — senha redefinida para a do .env`
        : `usuário '${ADMIN_USER}' criado (id ${user.id})`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(`\nseed falhou: ${e.message}`);
  process.exit(1);
});
