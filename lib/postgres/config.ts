import { z } from "zod";

/**
 * Where a Postgres connection points, and how. Safe for the browser: no
 * password here. Host, port and database are fixed once the connection is
 * saved; pointing elsewhere means a new connection.
 */

/** verify-full: encrypted, certificate checked (default). require: encrypted only. Never unencrypted. */
export const SSL_MODES = ["verify-full", "require"] as const;
export type SslMode = (typeof SSL_MODES)[number];

export const DEFAULT_PORT = 5432;

/** A DNS name or an IP literal. No scheme, path, user info or socket path. */
const HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.?$/;
const IPV6_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

export const hostSchema = z
  .string()
  .trim()
  .min(1, "Enter the host.")
  .refine(
    (host) => HOSTNAME.test(host) || (host.includes(":") && IPV6_LITERAL.test(host)),
    "Enter a host name or IP address, without postgres:// or a port.",
  );

export const portSchema = z.coerce
  .number({ error: "Enter a port number." })
  .int("Enter a port number.")
  .min(1, "Ports run from 1 to 65535.")
  .max(65535, "Ports run from 1 to 65535.");

export const databaseSchema = z.string().trim().min(1, "Enter the database name.").max(63, "Postgres names are at most 63 characters.");
export const userSchema = z.string().trim().min(1, "Enter the user name.").max(63, "Postgres names are at most 63 characters.");
export const passwordSchema = z.string().min(1, "Enter the password.").max(1024, "That password is too long.");
export const sslModeSchema = z.enum(SSL_MODES, { error: "Choose an SSL mode." });

export const postgresConfigSchema = z
  .object({
    host: hostSchema,
    port: portSchema,
    database: databaseSchema,
    user: userSchema,
    sslMode: sslModeSchema,
  })
  .strict();

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;

export type ParsedConnectionString = Partial<PostgresConfig & { password: string }>;

/**
 * Reads a postgres:// URL into form fields, for pasting. The string itself is
 * never stored or sent: only the fields are. Returns null for anything that
 * isn't a Postgres URL.
 */
export function parseConnectionString(input: string): ParsedConnectionString | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;

  const fields: ParsedConnectionString = {};
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (host) fields.host = decodeURIComponent(host);
  if (url.port) fields.port = Number(url.port);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database) fields.database = database;
  if (url.username) fields.user = decodeURIComponent(url.username);
  if (url.password) fields.password = decodeURIComponent(url.password);

  const sslmode = url.searchParams.get("sslmode");
  if (sslmode === "verify-full" || sslmode === "verify-ca") fields.sslMode = "verify-full";
  // prefer/allow/disable can mean no encryption, which Prism never uses: encrypt at least.
  else if (sslmode === "require" || sslmode === "prefer" || sslmode === "allow" || sslmode === "disable") {
    fields.sslMode = "require";
  }
  return fields;
}

/** `analyst@db.example.com:5432/app`, for lists. */
export function postgresAddress(config: Pick<PostgresConfig, "host" | "port" | "database" | "user">): string {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return `${config.user}@${host}:${config.port}/${config.database}`;
}
