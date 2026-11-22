import { describe, expect, it } from "vitest";

import { testPostgresConnection, type PostgresTarget } from "@/lib/sources/postgres/client";
import { isSupabaseDirectHost, parseConnectionString, postgresAddress, suggestConnectionName } from "@/lib/sources/postgres/catalog";
import { PostgresError, toPostgresError } from "@/lib/sources/postgres/errors";
import { BlockedAddressError, Ipv6OnlyHostError } from "@/lib/net/guarded-socket";

import { TEST_DATABASE_URL } from "./global-setup";

describe("parseConnectionString", () => {
  it("reads every field, decoding escapes", () => {
    expect(
      parseConnectionString("postgresql://analyst:p%40ss%2Fword@db.example.com:6543/app?sslmode=require"),
    ).toEqual({
      host: "db.example.com",
      port: 6543,
      database: "app",
      user: "analyst",
      password: "p@ss/word",
      sslMode: "require",
    });
  });

  it("maps sslmode to the closest mode we support", () => {
    const mode = (sslmode: string) => parseConnectionString(`postgres://h/db?sslmode=${sslmode}`)?.sslMode;
    expect(mode("verify-ca")).toBe("verify-full");
    expect(mode("verify-full")).toBe("verify-full");
    expect(mode("prefer")).toBe("require");
    // OpenDashboards never connects unencrypted, so "disable" still encrypts.
    expect(mode("disable")).toBe("require");
    expect(parseConnectionString("postgres://h/db")?.sslMode).toBeUndefined();
  });

  it("handles IPv6 hosts and leaves out what's missing", () => {
    expect(parseConnectionString("postgres://[2606:4700::1111]/app")).toEqual({ host: "2606:4700::1111", database: "app" });
  });

  it("reads the URL out of a psql command, an env line or quotes", () => {
    const expected = { host: "db.example.com", port: 5432, database: "app", user: "u", password: "p" };
    for (const text of [
      `psql "postgresql://u:p@db.example.com:5432/app"`,
      `psql 'postgresql://u:p@db.example.com:5432/app'`,
      `DATABASE_URL="postgres://u:p@db.example.com:5432/app"`,
      `export DATABASE_URL=postgres://u:p@db.example.com:5432/app`,
      `  'postgres://u:p@db.example.com:5432/app'  `,
    ]) {
      expect(parseConnectionString(text)).toEqual(expected);
    }
  });

  it("leaves out a placeholder password instead of sending it", () => {
    for (const placeholder of ["[YOUR-PASSWORD]", "[YOUR-DATABASE-PASSWORD]", "<password>", "****"]) {
      const parsed = parseConnectionString(`postgresql://postgres.abcdefghijklmnopqrst:${placeholder}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`);
      expect(parsed).toMatchObject({ host: "aws-1-ap-south-1.pooler.supabase.com", user: "postgres.abcdefghijklmnopqrst", passwordMissing: true });
      expect(parsed).not.toHaveProperty("password");
    }
    expect(parseConnectionString("postgres://u:s3cret@db.example.com/app")).not.toHaveProperty("passwordMissing");
  });

  it("knows Supabase's direct host, which only answers over IPv6", () => {
    expect(isSupabaseDirectHost("db.abcdefghijklmnopqrst.supabase.co")).toBe(true);
    expect(isSupabaseDirectHost("aws-0-us-east-1.pooler.supabase.com")).toBe(false);
    expect(isSupabaseDirectHost("db.example.com")).toBe(false);
  });

  it("suggests a name from the service or the database", () => {
    expect(suggestConnectionName({ host: "aws-0-us-east-1.pooler.supabase.com", database: "postgres" })).toBe("Supabase database");
    expect(suggestConnectionName({ host: "db.example.com", database: "shop" })).toBe("shop");
    expect(suggestConnectionName({})).toBe("Postgres database");
  });

  it("rejects anything that isn't a Postgres URL", () => {
    expect(parseConnectionString("mysql://h/db")).toBeNull();
    expect(parseConnectionString("not a url")).toBeNull();
  });

  it("formats an address for lists", () => {
    expect(postgresAddress({ host: "db.example.com", port: 5432, database: "app", user: "analyst" })).toBe(
      "analyst@db.example.com:5432/app",
    );
  });
});

describe("toPostgresError", () => {
  it.each([
    [{ code: "28P01" }, "auth_failed"],
    [{ code: "3D000" }, "database_not_found"],
    [{ code: "42501" }, "permission_denied"],
    [{ code: "ENOTFOUND" }, "host_not_found"],
    [{ code: "ECONNREFUSED" }, "unreachable"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls_failed"],
    [new Error("The server does not support SSL connections"), "ssl_unsupported"],
    [new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string"), "password_required"],
    // Supabase's pooler, in its older wording and its current "(ECODE) text" one.
    [Object.assign(new Error("Tenant or user not found"), { code: "XX000" }), "pooler_user_not_found"],
    [Object.assign(new Error("(ENOTFOUND) tenant/user postgres.abcdefghijklmnopqrst not found"), { code: "XX000" }), "pooler_user_not_found"],
    [Object.assign(new Error('(EINVALIDUSERINFO) Authentication error, reason: "Invalid format for user or db_name"'), { code: "XX000" }), "pooler_user_not_found"],
    [Object.assign(new Error("Circuit breaker open: Unable to establish connection to upstream database"), { code: "XX000" }), "connection_blocked"],
    [Object.assign(new Error("(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked"), { code: "XX000" }), "connection_blocked"],
    [Object.assign(new Error('(EADDRNOTALLOWED) address not in tenant allow_list: {1, 2, 3, 4}'), { code: "XX000" }), "address_not_allowed"],
    [Object.assign(new Error("(EMAXCONN) max clients reached in session mode - max clients are limited to pool_size: 15"), { code: "XX000" }), "too_many_connections"],
    [Object.assign(new Error("Max client connections reached"), { code: "XX000" }), "too_many_connections"],
    [Object.assign(new Error("(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 5000ms in Session mode"), { code: "XX000" }), "too_many_connections"],
    [{ code: "53300" }, "too_many_connections"],
    // PgBouncer answers before the database does, always as 08P01.
    [Object.assign(new Error("password authentication failed"), { code: "08P01" }), "auth_failed"],
    [Object.assign(new Error("SASL authentication failed"), { code: "08P01" }), "auth_failed"],
    [Object.assign(new Error("no such user"), { code: "08P01" }), "auth_failed"],
    [Object.assign(new Error("no such database: shop"), { code: "08P01" }), "database_not_found"],
    [Object.assign(new Error("no more connections allowed (max_client_conn)"), { code: "08P01" }), "too_many_connections"],
    [Object.assign(new Error("client connections exceeded (max_user_client_connections)"), { code: "08P01" }), "too_many_connections"],
    [Object.assign(new Error("query_wait_timeout"), { code: "08P01" }), "too_many_connections"],
    [Object.assign(new Error("server login has been failing, cached error: connect failed (server_login_retry)"), { code: "08P01" }), "unreachable"],
    [Object.assign(new Error("some other protocol violation"), { code: "08P01" }), "unexpected"],
    // The pooler's wrong-password error keeps Postgres's own code.
    [Object.assign(new Error('password authentication failed for user "postgres"'), { code: "28P01" }), "auth_failed"],
    // PgBouncer's wording: the setting's name must not be read as a timeout.
    [Object.assign(new Error("unsupported startup parameter: statement_timeout"), { code: "08P01" }), "unexpected"],
    [new Error("Connection terminated due to connection timeout"), "timeout"],
    [new BlockedAddressError("db.internal", "10.0.0.5"), "host_blocked"],
    [new Ipv6OnlyHostError("db.supabase.co"), "host_ipv6_only"],
    [new Error("something odd"), "unexpected"],
  ])("classifies %o as %s", (error, code) => {
    expect(toPostgresError(error).code).toBe(code);
  });
});

/**
 * The local Postgres from docker-compose is reachable, but it's on localhost:
 * the guard must refuse it by name and by IP before any login is attempted.
 */
describe("testPostgresConnection", () => {
  const url = new URL(TEST_DATABASE_URL);
  const local: PostgresTarget = {
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: "require",
  };
  const code = (target: Partial<PostgresTarget>) =>
    testPostgresConnection({ ...local, ...target }).then(
      () => "ok",
      (error: unknown) => (error instanceof PostgresError ? error.code : `not a PostgresError: ${String(error)}`),
    );

  it("refuses a running local server by name and by IP", async () => {
    expect(await code({})).toBe("host_blocked");
    expect(await code({ host: "127.0.0.1" })).toBe("host_blocked");
    expect(await code({ host: "::1" })).toBe("host_blocked");
  });

  it("refuses private and metadata addresses without connecting", async () => {
    expect(await code({ host: "10.0.0.5" })).toBe("host_blocked");
    expect(await code({ host: "169.254.169.254" })).toBe("host_blocked");
  });
});
