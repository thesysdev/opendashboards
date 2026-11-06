import "server-only";

import type { ConnectionOptions } from "node:tls";

import pg from "pg";

import { createGuardedSocket } from "@/lib/net/guarded-socket";

import type { PostgresConfig, SslMode } from "./config";
import { toPostgresError } from "./errors";

export type PostgresTarget = PostgresConfig & { password: string };

export type PostgresCheck = {
  /** e.g. "16.4". */
  serverVersion: string;
  /** The role can change data (superuser, or write rights on a table). Worth a warning. */
  canWrite: boolean;
};

const CONNECT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;

/** Does the role have any way to change data? Owners have every right, so they count. */
const WRITE_ACCESS_SQL = `
  SELECT r.rolsuper OR EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND (has_table_privilege(c.oid, 'INSERT')
        OR has_table_privilege(c.oid, 'UPDATE')
        OR has_table_privilege(c.oid, 'DELETE'))
  ) AS can_write
  FROM pg_roles r
  WHERE r.rolname = current_user`;

/**
 * Connects, runs a read-only check, and disconnects. The socket only reaches
 * public addresses (see lib/net/guarded-socket.ts), TLS follows the SSL mode,
 * and everything runs inside a READ ONLY transaction.
 */
export async function testPostgresConnection(target: PostgresTarget): Promise<PostgresCheck> {
  const client = new pg.Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: sslOptions(target.sslMode),
    stream: () => createGuardedSocket(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 2_000,
    application_name: "prism",
  });
  // A dropped connection emits 'error' on the client; without a listener it would crash the process.
  client.on("error", () => {});

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const version = await client.query<{ server_version: string }>("SHOW server_version");
    const access = await client.query<{ can_write: boolean | null }>(WRITE_ACCESS_SQL);
    await client.query("ROLLBACK");
    return {
      serverVersion: version.rows[0]?.server_version.split(" ")[0] ?? "unknown",
      canWrite: access.rows[0]?.can_write === true,
    };
  } catch (error) {
    throw toPostgresError(error);
  } finally {
    await client.end().catch(() => {});
  }
}

function sslOptions(mode: SslMode): ConnectionOptions {
  switch (mode) {
    case "verify-full":
      // Certificate chain and hostname checked; pg sets servername from the host.
      return { rejectUnauthorized: true };
    case "require":
      return { rejectUnauthorized: false };
  }
}
