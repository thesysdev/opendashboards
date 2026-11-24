// Applies any migrations in db/migrations that haven't run yet. Runs on every
// Vercel build, so a migration must keep the previous deployment working
// (add columns and tables; remove them in a later release).
//
// Uses the direct connection: migrations don't belong on a pooled one.

import { readFile } from "node:fs/promises";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_GIT_COMMIT_REF === "feat/billing-plans") {
    const repair = new URL("./repair-preview-workspaces.sql", import.meta.url);
    await client.query(await readFile(repair, "utf8"));
  }
  await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
} finally {
  await client.end();
}
