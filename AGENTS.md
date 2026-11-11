<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Analytics

Product analytics go to PostHog through `analytics` in `lib/analytics.ts`. It is off on localhost.

- **Events** are named `opendashboards:<noun>_<past-tense verb>`. `analytics.capture("app_created")` adds the prefix. Pageviews are automatic.
- **Capture in client components**, where the user's action resolves (after the server action returns), not in server actions or API routes.
- **Never send** prompts, SQL, connection names, hosts, credentials, dashboard titles or query results. Send only types, counts, lengths, outcomes and error codes.
- **Don't duplicate OpenUI Cloud's events.** Dashboard generation (model, tokens, cost, duration, status) and data-script runs (status, error code) are already recorded server-side as `dashboard_generation` and `dashboard_script_run`.
- **Add an event only for a question someone is asking.** Clicks, renames and deletes are covered by autocapture.
- Session replay masks every input. Keep secrets in `<input>` or `<textarea>`, never in plain text.
- Analytics must never break the action it measures: `analytics.*` never throws and is never awaited.

Current events: `connection_added`, `demo_dataset_installed`, `onboarding_step`, `app_created`, `chat_turn`, `dashboard_created`.
