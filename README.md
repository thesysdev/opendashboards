# Prism

Live dashboards from your data, built by chatting. So far: **Data Connections** (adding,
testing and managing PostHog connections) and **Apps** (the home page, the app workspace, and
the chat thread mapping, ready for the chat milestone).

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm db:up        # Postgres on localhost:54329 (plus a prism_test database)
pnpm db:reset     # create the tables from lib/db/schema.ts
pnpm dev
```

Without `GATEWAY_SHARED_SECRET`, requests act as the dev user in `config/local.ts`, or as
whatever `X-User-Id` header a request sends. Without `KMS_KEY_ID`, API keys are stored
unencrypted. Both fallbacks only work outside production.

## Tests

```bash
pnpm test
```

The service tests run against the `prism_test` database from `pnpm db:up`.

## How it fits together

| Area | Where |
| --- | --- |
| Gateway auth (`X-User-Id` + `X-Gateway-Secret`) | `lib/auth/`, `proxy.ts` |
| Secret storage (`SecretBox`: `plaintext` locally, `kms` in production) | `lib/secrets/` |
| PostHog client (fixed US/EU hosts, error classification) | `lib/posthog/` |
| Connection service (validation, ownership, statuses) | `lib/connections/` |
| Apps, connection usage, thread mapping | `lib/apps/`, `app/api/apps/[appId]/threads/` |
| Schema and migrations | `lib/db/schema.ts`, `db/migrations/` |
| UI | `app/(app)/`, `components/` |

## Schema changes

Edit `lib/db/schema.ts`, run `pnpm db:generate` to write the migration, then `pnpm db:reset`
to rebuild your local database from the migrations (it drops all data and refuses non-local
databases). The test suite resets `prism_test` the same way before it runs.

Every Vercel build runs `pnpm db:migrate` before building, so a migration runs while the
previous deployment is still serving. Keep migrations additive, and remove old columns in a
later release.
