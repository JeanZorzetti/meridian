## Layout

npm workspaces. Run every command from the repo root.

```
apps/site      Astro — institutional site, and (for now) /login, /admin, /api/*
packages/core  money math: budget, insights, cards, categorize. Pure, integer cents, zero I/O
packages/db    Postgres client, queries, sessions, migrations
packages/ui    Dark Swiss tokens + shadcn primitives, shared by every app
```

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
  see `ssr.noExternal` in `apps/site/astro.config.mjs`. Without it the build
  passes and the server dies on first import.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

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

