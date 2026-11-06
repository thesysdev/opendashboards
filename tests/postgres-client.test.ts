import { describe, expect, it } from "vitest";

import { testPostgresConnection, type PostgresTarget } from "@/lib/postgres/client";
import { parseConnectionString, postgresAddress } from "@/lib/postgres/config";
import { PostgresError, toPostgresError } from "@/lib/postgres/errors";
import { BlockedAddressError } from "@/lib/net/guarded-socket";

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
    expect(mode("disable")).toBe("disable");
    expect(parseConnectionString("postgres://h/db")?.sslMode).toBeUndefined();
  });

  it("handles IPv6 hosts and leaves out what's missing", () => {
    expect(parseConnectionString("postgres://[2606:4700::1111]/app")).toEqual({ host: "2606:4700::1111", database: "app" });
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
    [new Error("The server does not support SSL connections"), "tls_failed"],
    [new Error("Connection terminated due to connection timeout"), "timeout"],
    [new BlockedAddressError("db.internal", "10.0.0.5"), "host_blocked"],
    [new Error("something odd"), "unexpected"],
  ])("classifies %o as %s", (error, code) => {
    expect(toPostgresError(error).code).toBe(code);
  });
});

/**
 * Against the real Postgres from docker-compose (the test database). It
 * lives on localhost, so these also prove the address guard: without
 * allowLocal, the same server is refused.
 */
describe("testPostgresConnection (local Postgres)", () => {
  const url = new URL(TEST_DATABASE_URL);
  const local: PostgresTarget = {
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: "disable",
  };
  const check = (target: Partial<PostgresTarget>, allowLocal = true) =>
    testPostgresConnection({ ...local, ...target }, { allowLocal });
  const code = (promise: Promise<unknown>) =>
    promise.then(
      () => "ok",
      (error: unknown) => (error instanceof PostgresError ? error.code : `not a PostgresError: ${String(error)}`),
    );

  it("connects, reports the version, and notices a user that can write", async () => {
    const result = await check({});
    expect(result.serverVersion).toMatch(/^\d+(\.\d+)?/);
    // The test user owns the tables.
    expect(result.canWrite).toBe(true);
  });

  it("refuses the same server when local hosts aren't allowed", async () => {
    expect(await code(check({}, false))).toBe("tls_failed"); // SSL off is local-only too
    expect(await code(check({ sslMode: "require" }, false))).toBe("host_blocked");
    expect(await code(check({ host: "127.0.0.1", sslMode: "require" }, false))).toBe("host_blocked");
  });

  it("reports a wrong password, an unknown database and a closed port", async () => {
    expect(await code(check({ password: "wrong" }))).toBe("auth_failed");
    expect(await code(check({ database: "no_such_database" }))).toBe("database_not_found");
    expect(await code(check({ port: 1 }))).toBe("unreachable");
  });

  it("fails TLS against a server without SSL", async () => {
    expect(await code(check({ sslMode: "require" }))).toBe("tls_failed");
  });
});
