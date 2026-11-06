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

Without `GATEWAY_SHARED_SECRET`, requests act as `DEV_USER_ID`, or as whatever `X-User-Id`
header a request sends. Without `KMS_KEY_ID`, API keys are stored unencrypted. Both
fallbacks only work outside production.

## Tests

```bash
pnpm test
```

The service tests run against the `prism_test` database from `pnpm db:up`.

## How it fits together

| Area | Where |
| --- | --- |
| Gateway auth (`X-User-Id` + `X-Gateway-Secret`) | `lib/auth/`, `proxy.ts` |
| Secret storage (`SecretBox`: `plaintext` now, `kms` stubbed) | `lib/secrets/` |
| PostHog client (fixed US/EU hosts, error classification) | `lib/posthog/` |
| Connection service (validation, ownership, statuses) | `lib/connections/` |
| Apps, connection usage, thread mapping | `lib/apps/`, `app/api/apps/[appId]/threads/` |
| Schema and migrations | `lib/db/schema.ts`, `db/migrations/` |
| UI | `app/(app)/`, `components/` |

While Prism is being built there are no migrations. To change the schema, edit
`lib/db/schema.ts` and run `pnpm db:reset`: it drops all data and recreates the tables (it
refuses non-local databases). The test suite resets `prism_test` the same way before it runs.
