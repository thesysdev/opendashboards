# Prism

Live dashboards from your data, built by chatting. This repository currently contains the
**Data Connections** slice: adding, testing and managing PostHog connections.

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm db:up        # Postgres on localhost:54329 (plus a prism_test database)
pnpm db:migrate
pnpm dev
```

Without `GATEWAY_SHARED_SECRET`, requests act as `DEV_USER_ID`, or as whatever `X-User-Id`
header a request sends. Without `KMS_KEY_ID`, API keys are stored unencrypted. Both
fallbacks only work outside production.

## Tests

```bash
pnpm test
```

The connection service tests run against the `prism_test` database from `pnpm db:up`.

## How it fits together

| Area | Where |
| --- | --- |
| Gateway auth (`X-User-Id` + `X-Gateway-Secret`) | `lib/auth/`, `proxy.ts` |
| Secret storage (`SecretBox`: `plaintext` now, `kms` stubbed) | `lib/secrets/` |
| PostHog client (fixed US/EU hosts, error classification) | `lib/posthog/` |
| Connection service (validation, ownership, statuses) | `lib/connections/` |
| Schema and migrations | `lib/db/schema.ts`, `db/migrations/` |
| UI | `app/(app)/`, `components/` |

Schema changes: edit `lib/db/schema.ts`, then run `pnpm db:generate` and `pnpm db:migrate`.
