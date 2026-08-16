## Layout

npm workspaces. Run every command from the repo root.

```
apps/site      Astro — institutional site, and (until the cutover) /login, /admin, /api/*
apps/app       Next.js App Router — the same login, panel and API, mounted at /app
packages/core  money math: budget, insights, cards, categorize. Pure, integer cents, zero I/O
packages/db    Postgres client, queries, sessions, migrations
packages/ui    Dark Swiss tokens + shadcn primitives, shared by every app
```

**Both apps currently serve the budget panel, and only the site is deployed.**
`BudgetApp.tsx` and `classify-llm.ts` exist in both, each marked as a temporary
duplicate at the top of the file — change both or neither. The site's copies are
deleted once the app is live at /app (rodada C in docs/HANDOFF.md §8.3).

`packages/core` is the one place that decides what a number means. Both apps
import it; neither reimplements it. Its tests (`npm test`) are the contract.

Cross-package imports go through the package name, never a relative path that
climbs out of a package: `@meridian/core/budget`, `@meridian/db`,
`@meridian/db/auth`, `@meridian/ui/components/button`, `@meridian/ui/global.css`.
The `exports` map in each package.json is the full list of what's importable.

Two things break quietly if you forget them:

- **New app under `apps/`** — Tailwind finds classes via the `@source` lines at
  the top of `packages/ui/src/styles/global.css`. `apps/` is already covered;
  anywhere else is not, and the symptom is CSS that silently doesn't exist.
- **Workspace packages export raw `.ts`.** An app's bundler must inline them —
  `ssr.noExternal` in `apps/site/astro.config.mjs`, `transpilePackages` in
  `apps/app/next.config.ts`. Without it the build passes and the server dies on
  first import.

And one that only shows up in the second app: **a shared package must not lean on
an app's ambient types.** `packages/db` read `import.meta.env.DATABASE_URL`,
whose `ImportMetaEnv` interface is declared by whichever app is compiling — fine
under Astro, a type error under Next. It now reads the same value through a local
cast (`db.ts`), so the package compiles under both.

## Development

`apps/app` is mounted at `/app` via `basePath`, so every route it owns starts
with that prefix and nothing outside it is claimed. Next applies the prefix to
`<Link>` and to `redirect()` on its own, but **not** to `fetch()` and not to a
`Location` header written by hand — both of those go through `appPath()` in
`apps/app/src/lib/paths.ts`. A bare `/api/…` leaves the app and lands on the
Astro site next door.

```
npm run dev          # Astro site
npm run dev:app      # Next app  (http://localhost:3000/app)
npm run build:all    # both, the check to run before pushing
```

`next start` reads env from the process, not from the repo-root `.env` — export
`DATABASE_URL` before running the app outside `npm run dev`.

When starting the Astro dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Deploy

Two EasyPanel services from this one repo, both built by Nixpacks from the repo
root. They differ only in which scripts they run:

| Service | Install | Build | Start |
|---|---|---|---|
| site | *(empty)* | *(empty)* | *(empty)* |
| app | *(empty)* | `npm run build:app` | `npm run start:app` |

The site's three fields are empty on purpose — Nixpacks then reads the root
`package.json` and runs `npm ci`, `npm run build`, `npm start`, which is what
makes the monorepo work without a Dockerfile. **Do not write a path into them.**
Root `build` and `start` are therefore reserved for the site; the app has its own
`build:app` / `start:app` beside them.

## Database

The schema is a set of versioned migrations in `packages/db/migrations/NNNN_name.sql`,
applied by `packages/db/migrate.mjs`. **The deploy does not migrate the database** —
until a release hook exists, someone runs this by hand after every deploy that
touches the schema.

```
npm run db:migrate              # apply everything pending (safe to re-run)
npm run db:migrate -- --status  # what's applied, what's pending, what drifted
npm run db:seed                 # create/reset the .env admin user
npm run db:init                 # migrate + seed
```

Rules for writing one:

- **Never edit a migration that has already been applied anywhere.** The runner
  stores a hash of each applied file and refuses to run when it changes. Fix
  forward with a new migration instead.
- `0001_baseline.sql` is the pre-migration schema and is idempotent so existing
  databases adopt it untouched. **From `0002` on, migrations are plain forward
  steps and run exactly once** — no `if not exists` ceremony needed.
- Each migration runs in a transaction. If it genuinely can't (`create index
  concurrently`), put `-- migrate:no-transaction` on its own line, and write it so
  a retry after a crash is safe.
- `npm test` checks naming, ordering and hashing (plus all the money math). It
  does not touch a database — verify that half by running `db:migrate` twice
  against a real one: the second run must print `nada pendente`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

