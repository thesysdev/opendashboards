import "server-only";

import { z } from "zod";

import { config as appConfig } from "@/config";

import { passwordHint } from "../password-hint";
import type { ConnectionSource, SourceTool } from "../types";

import { passwordSchema, postgresCatalog, type PostgresConfig } from "./catalog";
import { listPostgresTables, queryPostgres, testPostgresConnection } from "./client";
import { PostgresError } from "./errors";


const target = (connection: { config: PostgresConfig; credential: string }) => ({
  ...connection.config,
  password: connection.credential,
});

const queryTool: SourceTool<PostgresConfig, { sql: string; params?: (string | number | boolean | null)[] }> = {
  name: "postgres_query",
  description:
    "Run one read-only SELECT on the database. Pass filter values as params and reference them as $1, $2, … " +
    "instead of writing them into the SQL. Returns { columns, rows: [{ column: value }], truncated }.",
  parameters: z.object({
    sql: z.string().min(1).describe("One SELECT (or WITH … SELECT) statement."),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe("Values for $1, $2, … in order."),
  }),
  output: {
    columns: ["day", "orders"],
    rows: [
      { day: "2026-10-30", orders: 412 },
      { day: "2026-10-31", orders: 398 },
    ],
    truncated: false,
  },
  callers: ["agent", "dashboard"],
  execute: (connection, { sql, params = [] }, { caller }) =>
    queryPostgres(target(connection), sql, params, appConfig().postgres.maxRows[caller]),
};

const tablesTool: SourceTool<PostgresConfig, { schema?: string }> = {
  name: "postgres_tables",
  description: "The tables and views this connection can read, with their columns and types. Optionally one schema only.",
  parameters: z.object({ schema: z.string().min(1).optional() }),
  output: {
    columns: ["schema", "table", "kind", "columns"],
    rows: [{ schema: "public", table: "orders", kind: "BASE TABLE", columns: "id bigint, created_at timestamp with time zone" }],
    truncated: false,
  },
  callers: ["agent"],
  execute: (connection, { schema }) => listPostgresTables(target(connection), schema),
};

export const postgresSource: ConnectionSource<PostgresConfig> = {
  ...postgresCatalog,
  credential: {
    field: "password",
    schema: passwordSchema,
    purpose: "postgres-password",
    hint: passwordHint,
  },
  async test(config, credential) {
    const check = await testPostgresConnection({ ...config, password: credential });
    return check.canWrite ? ["can_write"] : [];
  },
  toError(error) {
    if (!(error instanceof PostgresError)) return null;
    switch (error.code) {
      case "auth_failed":
        return {
          status: "invalid",
          error: {
            code: "auth_failed",
            field: "password",
            message:
              error.flavor === "supabase"
                ? "Supabase didn't accept this user and password. Check them before trying again: after repeated wrong attempts Supabase blocks new connections for a few minutes. The database password is under Database → Settings in Supabase."
                : "Postgres didn't accept this user and password. If they're right, the server may not allow logins from OpenDashboards' address.",
          },
        };
      case "password_required":
        return { status: "invalid", error: { code: "password_required", field: "password", message: "This server needs a password. Enter the one for this user." } };
      case "pooler_user_not_found":
        return {
          status: "invalid",
          error: {
            code: "pooler_user_not_found",
            field: "user",
            message:
              "Supabase's pooler doesn't know this user. On the pooler the user ends with your project ref, like dashboards_reader.your-project-ref. Copy it, and the host, from the Session pooler string in Supabase → Connect.",
          },
        };
      case "connection_blocked":
        return {
          status: "unavailable",
          error: {
            code: "connection_blocked",
            message:
              "Supabase is refusing new connections for now, which it does after repeated failed attempts. Wait a couple of minutes, check the password in Supabase, then try once.",
          },
        };
      case "address_not_allowed":
        return {
          status: "invalid",
          error: {
            code: "address_not_allowed",
            field: "host",
            message:
              "This Supabase project only accepts connections from the addresses in its Network Restrictions, and OpenDashboards isn't one of them. OpenDashboards has no fixed address to add there, so it can only connect while the project allows all addresses.",
          },
        };
      case "too_many_connections":
        return {
          status: "unavailable",
          error: {
            code: "too_many_connections",
            message:
              error.flavor === "supabase"
                ? "The database has no free connections right now. Try again shortly; if it keeps happening, use the Transaction pooler (port 6543) or raise the pool size in Supabase."
                : "The database has no free connections right now. Try again shortly, or raise its connection limit.",
          },
        };
      case "database_not_found":
        return { status: "invalid", error: { code: "database_not_found", field: "database", message: "There's no database with this name on the server." } };
      case "permission_denied":
        return { status: "invalid", error: { code: "permission_denied", field: "user", message: "This user isn't allowed to connect to that database." } };
      case "no_read_access":
        return {
          status: "invalid",
          error: {
            code: "no_read_access",
            field: "user",
            message: "This user can connect but can't read any tables, so dashboards would have no data. Give it read access to the tables you want to use, then test again.",
          },
        };
      case "host_blocked":
        return {
          status: "invalid",
          error: {
            code: "host_blocked",
            field: "host",
            message: "This host points to a private or reserved address. OpenDashboards only connects to databases reachable on the public internet.",
          },
        };
      case "host_not_found":
        return { status: "invalid", error: { code: "host_not_found", field: "host", message: "This host name doesn't resolve. Check it for typos." } };
      case "host_ipv6_only":
        return {
          status: "invalid",
          error: {
            code: "host_ipv6_only",
            field: "host",
            message:
              "This host only answers over IPv6, which OpenDashboards can't reach. If this is Supabase, use the Session pooler string from Supabase → Connect instead of the direct connection string.",
          },
        };
      case "unreachable":
        return {
          status: "unavailable",
          error: {
            code: "unreachable",
            field: "host",
            message:
              error.flavor === "supabase"
                ? "Couldn't reach the database. Check the host and port. If a wrong password was just tried, Supabase may have blocked the address for about 30 minutes: wait, or lift the ban under Database → Settings in Supabase."
                : "Couldn't reach the server. Check the host and port, and that the database accepts connections from OpenDashboards.",
          },
        };
      case "timeout":
        return {
          status: "unavailable",
          error: {
            code: "timeout",
            field: "host",
            message: "The server didn't answer in time. Check the host and port, or allowlist OpenDashboards' address in your firewall.",
          },
        };
      case "tls_failed":
        return {
          status: "invalid",
          error: {
            code: "tls_failed",
            field: "sslMode",
            message: "Couldn't set up an encrypted connection. If the server's certificate can't be verified, turn on \"Skip certificate check\".",
          },
        };
      case "ssl_unsupported":
        return {
          status: "invalid",
          error: {
            code: "ssl_unsupported",
            field: "sslMode",
            message: "This server doesn't accept encrypted (SSL) connections, and OpenDashboards never connects without encryption. Turn SSL on for the database, then try again.",
          },
        };
      case "tls_handshake_failed":
        return {
          status: "invalid",
          error: {
            code: "tls_handshake_failed",
            field: "sslMode",
            message: "Couldn't set up an encrypted connection with this server, even without checking its certificate. Check that the port is the database's own and that SSL is switched on for it.",
          },
        };
      case "bad_query":
        return { status: "unavailable", error: { code: "bad_query", message: `SQL error: ${error.detail ?? "the query was rejected."}` } };
      case "unexpected":
        return { status: "unavailable", error: { code: "postgres_unexpected", message: "Postgres returned an unexpected error. Try again." } };
    }
  },
  tools: [queryTool, tablesTool],
};
