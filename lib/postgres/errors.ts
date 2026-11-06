import { BlockedAddressError } from "@/lib/net/guarded-socket";

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
  /** Nothing answered, the connection was refused, or the server is full. */
  | "unreachable"
  /** Connecting or the test query took too long. */
  | "timeout"
  /** TLS failed: no SSL on the server, or a certificate we couldn't verify. */
  | "tls_failed"
  /** Anything else. */
  | "unexpected";

export class PostgresError extends Error {
  constructor(
    readonly code: PostgresErrorCode,
    /** The driver's message, for logs only: it can mention hosts and users. */
    readonly detail?: string,
  ) {
    super(`Postgres check failed: ${code}`);
    this.name = "PostgresError";
  }
}

const NETWORK_UNREACHABLE = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EPIPE"]);
const TLS_CODES = /^(ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_|CERT_|HOSTNAME_MISMATCH)/;

/** Classifies whatever pg, Node's net/tls/dns or our address guard threw. */
export function toPostgresError(error: unknown): PostgresError {
  if (error instanceof PostgresError) return error;

  // The guard's error can arrive wrapped by the driver.
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if (e instanceof BlockedAddressError) return new PostgresError("host_blocked", e.message);
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
    case "57P03":
      return new PostgresError("unreachable", message);
    case "57014":
      return new PostgresError("timeout", message);
    // Node network errors.
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EAI_NONAME":
      return new PostgresError("host_not_found", message);
    case "ETIMEDOUT":
      return new PostgresError("timeout", message);
  }
  if (NETWORK_UNREACHABLE.has(code)) return new PostgresError("unreachable", message);
  if (TLS_CODES.test(code) || /does not support SSL|certificate|self[- ]signed|SSL/i.test(message)) {
    return new PostgresError("tls_failed", message);
  }
  if (/timeout|timed out/i.test(message)) return new PostgresError("timeout", message);
  if (/terminated unexpectedly|Connection terminated/i.test(message)) {
    return new PostgresError("unreachable", message);
  }
  return new PostgresError("unexpected", message);
}
