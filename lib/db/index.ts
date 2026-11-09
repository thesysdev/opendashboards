import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { secrets } from "@/config";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(connectionString: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per process. In development, keep it across hot reloads.
const globalForDb = globalThis as unknown as { prismDb?: Database };

export function getDb(): Database {
  if (!globalForDb.prismDb) {
    const url = secrets.databaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.prismDb = createDatabase(url).db;
  }
  return globalForDb.prismDb;
}
