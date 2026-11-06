// Fills the local database with mock data so the UI has something to show:
// three data connections and a dozen apps with dashboards. Replaces the
// seeded user's existing apps and connections. Local databases only.
//
// Usage: pnpm db:seed               (user = DEV_USER_ID from .env.local, or dev-user)
//        pnpm db:seed --user alice
//
// The connections hold fake keys, so "Test again" marks them invalid, and the
// dashboards point at artifact ids that don't exist in OpenUI Cloud.

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { hostname } = new URL(url);
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  console.error(`Refusing to seed a non-local database (${hostname}).`);
  process.exit(1);
}

const userFlag = process.argv.indexOf("--user");
const userId = userFlag > -1 ? process.argv[userFlag + 1] : process.env.DEV_USER_ID || "dev-user";

const HOUR = 3_600_000;
const ago = (hours) => new Date(Date.now() - hours * HOUR);
const fakeKey = (suffix) => `phx_MockKeyForLocalDevelopmentOnly${suffix}`;

const connections = [
  { key: "prod", name: "Production analytics", hostKind: "posthog_us", projectId: "41231", status: "ok", checked: 2 },
  { key: "web", name: "Marketing site", hostKind: "posthog_eu", projectId: "8812", status: "ok", checked: 30 },
  { key: "staging", name: "Staging", hostKind: "posthog_us", projectId: "41232", status: "invalid", checked: 72 },
].map((c, i) => ({ ...c, id: randomUUID(), apiKey: fakeKey(String(i).padStart(4, "0")) }));
const byKey = Object.fromEntries(connections.map((c) => [c.key, c.id]));

const apps = [
  { name: "Growth metrics", hours: 1, uses: ["prod", "web"], dashboards: ["Overview", "Acquisition", "Activation", "Weekly report"] },
  { name: "Signup funnel", hours: 5, uses: ["prod"], dashboards: ["Funnel", "Drop-off by step"] },
  { name: "Retention cohorts", hours: 20, uses: ["prod"], dashboards: ["Weekly cohorts"] },
  { name: "Marketing attribution", hours: 26, uses: ["web", "prod"], dashboards: ["Channels", "Campaigns", "Landing pages"] },
  { name: "Feature adoption: Search", hours: 50, uses: ["prod"], dashboards: ["Usage", "Queries"] },
  { name: "Onboarding health", hours: 74, uses: ["prod"], dashboards: ["Checklist completion"] },
  { name: "Weekly exec summary", hours: 98, uses: ["prod", "web"], dashboards: ["Summary"] },
  { name: "Mobile app engagement", hours: 140, uses: ["prod"], dashboards: ["Sessions", "Screens"] },
  { name: "Experiments overview", hours: 200, uses: ["prod"], dashboards: ["Running", "Results"] },
  { name: "Support load", hours: 300, uses: [], dashboards: [] },
  { name: "Staging smoke checks", hours: 420, uses: ["staging"], dashboards: ["Errors"] },
  {
    name: "Churn signals",
    hours: 0.2,
    uses: [],
    dashboards: [],
    pendingPrompt: "Which behaviours in the first two weeks predict churn? Compare users who stayed with users who left.",
    pendingUses: ["prod"],
  },
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("DELETE FROM apps WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM data_connections WHERE user_id = $1", [userId]);

  for (const c of connections) {
    await client.query(
      `INSERT INTO data_connections
         (id, user_id, name, type, host_kind, project_id, secret, key_hint, status, last_checked_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'posthog', $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        c.id,
        userId,
        c.name,
        c.hostKind,
        c.projectId,
        JSON.stringify({ v: 1, provider: "plaintext", value: c.apiKey }),
        `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-4)}`,
        c.status,
        ago(c.checked),
        ago(24 * 30),
      ],
    );
  }

  let artifact = 0;
  for (const app of apps) {
    const appId = randomUUID();
    await client.query(
      `INSERT INTO apps (id, user_id, name, pending_prompt, pending_connection_ids, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        appId,
        userId,
        app.name,
        app.pendingPrompt ?? null,
        app.pendingUses ? app.pendingUses.map((key) => byKey[key]) : null,
        ago(app.hours + 24 * 7),
        ago(app.hours),
      ],
    );
    for (const key of app.uses) {
      await client.query("INSERT INTO app_connections (app_id, connection_id) VALUES ($1, $2)", [appId, byKey[key]]);
    }
    for (const [position, title] of app.dashboards.entries()) {
      await client.query(
        `INSERT INTO dashboards (app_id, user_id, artifact_id, title, position) VALUES ($1, $2, $3, $4, $5)`,
        [appId, userId, `art_mock_${String(++artifact).padStart(4, "0")}`, title, position],
      );
    }
  }
  await client.query("COMMIT");
  console.log(`Seeded ${connections.length} connections and ${apps.length} apps for "${userId}".`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
