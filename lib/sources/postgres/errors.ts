import { BlockedAddressError, Ipv6OnlyHostError } from "@/lib/net/guarded-socket";

import type { PostgresFlavor } from "./catalog";

export type PostgresErrorCode =
  /** Wrong user or password, or the server's pg_hba.conf refuses this login. */
  | "auth_failed"
  /** No database with that name. */
  | "database_not_found"
  /** The user may not connect to this database. */
  | "permission_denied"
  /** The host resolves to a private, loopback or otherwise blocked address. */
  | "host_blocked"
  /** DNS has no such host. */
  | "host_not_found"
  /** The host only has an IPv6 address, which we have no route to. */
  | "host_ipv6_only"
  /** Nothing answered, the connection was refused, or the server is full. */
  | "unreachable"
  /** Connecting or the test query took too long. */
  | "timeout"
  /** The server asked for a password and none was given. */
  | "password_required"
  /** Supabase's pooler has no project or user by this name: usually a user without its project ref. */
  | "pooler_user_not_found"
  /** Supabase's pooler is refusing new connections for a while, after failed logins from this address. */
  | "connection_blocked"
  /** The project only accepts allowlisted addresses (Supabase Network Restrictions), and ours isn't one. */
  | "address_not_allowed"
  /** The server or its pooler has no free connection. */
  | "too_many_connections"
  /** The server has SSL switched off. We never connect unencrypted, so it can't be used as it is. */
  | "ssl_unsupported"
  /** TLS failed: most often a certificate we couldn't verify. */
  | "tls_failed"
  /** TLS failed although the certificate isn't checked ("Skip certificate check"), so that setting can't fix it. */
  | "tls_handshake_failed"
  /** The SQL itself failed (syntax, unknown table, a write in a read-only query…); `detail` says why. */
  | "bad_query"
  /** Anything else. */
  | "unexpected";

export class PostgresError extends Error {
  constructor(
    readonly code: PostgresErrorCode,
    /** The driver's message. Shown to the query's author for bad_query; logs only otherwise. */
    readonly detail?: string,
    /** The hosted service the host belongs to, when the advice differs for it. */
    readonly flavor: PostgresFlavor | null = null,
  ) {
    super(`Postgres check failed: ${code}`);
    this.name = "PostgresError";
  }
}

const NETWORK_UNREACHABLE = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EPIPE"]);
const TLS_CODES = /^(ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_|CERT_|HOSTNAME_MISMATCH)/;

/**
 * Supabase's pooler (Supavisor) reports its own failures as FATAL XX000 with the reason in the
 * message: "(ECODE) text" in current versions, bare text in older ones. Both are matched.
 * The wording is from its source (lib/supavisor/errors) and Supabase's troubleshooting docs.
 */
function supabasePoolerError(message: string): PostgresErrorCode | null {
  // No project or user by this name: a user without its project ref, the wrong region's host, or a malformed name.
  if (/\((ENOTFOUND|EINVALIDUSERINFO|ENOIDENTIFIER|EMULTIPLEUSERS)\)|Tenant or user not found|tenant\/user \S+ not found|Invalid format for user or db_name/i.test(message)) {
    return "pooler_user_not_found";
  }
  // New connections are refused for a while after failed logins or failed attempts to reach the database.
  if (/\(ECIRCUITBREAKER\)|Circuit breaker open|connections are temporarily blocked/i.test(message)) return "connection_blocked";
  if (/\(EADDRNOTALLOWED\)|address not in tenant allow_list/i.test(message)) return "address_not_allowed";
  if (/\((EMAXCONN|ECHECKOUTTIMEOUT|EMAXPOOLSREACHED)\)|max clients? (connections )?reached|unable to check out connection from the pool|max pools count reached/i.test(message)) {
    return "too_many_connections";
  }
  return null;
}

/**
 * PgBouncer answers for the database until a login succeeds, and reports its own
 * refusals as protocol violations (08P01) with the reason only in the message.
 * The wording is from its source (src/client.c, src/objects.c, src/janitor.c).
 */
function pgbouncerError(message: string): PostgresErrorCode | null {
  if (/no such database/i.test(message)) return "database_not_found";
  // "no such user" too: newer versions answer an unknown user as a wrong password, so one message covers both.
  if (/password authentication failed|SASL authentication failed|no such user|login rejected|"trust" authentication failed|empty password returned by client/i.test(message)) {
    return "auth_failed";
  }
  if (/no more connections allowed|client connections exceeded|query_wait_timeout/i.test(message)) return "too_many_connections";
  // It can't reach, or can't log in to, the database behind it.
  if (/server login has been failing|pgbouncer cannot connect to server|client_login_timeout|server shutting down/i.test(message)) return "unreachable";
  return null;
}

/** Classifies whatever pg, Node's net/tls/dns or our address guard threw. */
export function toPostgresError(error: unknown): PostgresError {
  if (error instanceof PostgresError) return error;

  // The guard's error can arrive wrapped by the driver.
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if (e instanceof BlockedAddressError) return new PostgresError("host_blocked", e.message);
    if (e instanceof Ipv6OnlyHostError) return new PostgresError("host_ipv6_only", e.message);
  }

  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err?.code === "string" ? err.code : "";
  const message = typeof err?.message === "string" ? err.message : String(error);

  switch (code) {
    // SQLSTATEs from the server.
    case "28P01":
    case "28000":
      return new PostgresError("auth_failed", message);
    case "3D000":
      return new PostgresError("database_not_found", message);
    case "42501":
      return new PostgresError("permission_denied", message);
    case "53300":
      return new PostgresError("too_many_connections", message);
    case "57P03":
      return new PostgresError("unreachable", message);
    case "57014":
      return new PostgresError("timeout", message);
    case "25006":
      return new PostgresError("bad_query", "Queries are read-only: only SELECT is allowed.");
    // Node network errors.
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EAI_NONAME":
      return new PostgresError("host_not_found", message);
    case "ETIMEDOUT":
      return new PostgresError("timeout", message);
  }
  if (NETWORK_UNREACHABLE.has(code)) return new PostgresError("unreachable", message);
  // The driver refuses to answer a password challenge (SCRAM) with an empty password.
  if (/client password must be/i.test(message)) return new PostgresError("password_required", message);
  const pooler = supabasePoolerError(message) ?? (code === "08P01" ? pgbouncerError(message) : null);
  if (pooler) return new PostgresError(pooler, message);
  // A pooler that refuses a connection setting. Named here so the word "timeout" in the setting's name isn't read as one.
  if (/unsupported startup parameter/i.test(message)) return new PostgresError("unexpected", message);
  // SQLSTATE classes for a query the server understood but rejected: syntax and
  // access rules (42), data (22), feature (0A), cursor and transaction state (24, 25, 34).
  if (/^(42|22|0A|24|25|34)[0-9A-Z]{3}$/.test(code)) return new PostgresError("bad_query", message);
  if (/does not support SSL/i.test(message)) return new PostgresError("ssl_unsupported", message);
  if (TLS_CODES.test(code) || /certificate|self[- ]signed|SSL/i.test(message)) {
    return new PostgresError("tls_failed", message);
  }
  if (/timeout|timed out/i.test(message)) return new PostgresError("timeout", message);
  if (/terminated unexpectedly|Connection terminated/i.test(message)) {
    return new PostgresError("unreachable", message);
  }
  return new PostgresError("unexpected", message);
}
