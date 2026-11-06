import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  authenticate,
  getAuthConfig,
  GATEWAY_SECRET_HEADER,
  USER_ID_HEADER,
} from "@/lib/auth/gateway";

const SECRET = "s".repeat(40);
const headers = (values: Record<string, string>) => new Headers(values);

describe("getAuthConfig", () => {
  it("uses gateway mode when a secret is set", () => {
    expect(getAuthConfig({ GATEWAY_SHARED_SECRET: SECRET })).toEqual({ mode: "gateway", secret: SECRET });
  });

  it("refuses production without a secret", () => {
    expect(() => getAuthConfig({ NODE_ENV: "production" })).toThrow(AuthConfigError);
  });

  it("refuses a short secret", () => {
    expect(() => getAuthConfig({ GATEWAY_SHARED_SECRET: "short" })).toThrow(AuthConfigError);
  });

  it("falls back to the dev user outside production", () => {
    expect(getAuthConfig({ NODE_ENV: "development", DEV_USER_ID: "alice" })).toEqual({
      mode: "dev",
      devUserId: "alice",
    });
  });
});

describe("authenticate in gateway mode", () => {
  const config = { mode: "gateway" as const, secret: SECRET };

  it("accepts the right secret and a user id", () => {
    const result = authenticate(
      headers({ [GATEWAY_SECRET_HEADER]: SECRET, [USER_ID_HEADER]: "user_1" }),
      config,
    );
    expect(result).toEqual({ ok: true, userId: "user_1" });
  });

  it("rejects a missing secret, even with a user id", () => {
    expect(authenticate(headers({ [USER_ID_HEADER]: "user_1" }), config)).toEqual({
      ok: false,
      reason: "missing_secret",
    });
  });

  it("rejects a wrong secret", () => {
    const result = authenticate(
      headers({ [GATEWAY_SECRET_HEADER]: `${SECRET}x`, [USER_ID_HEADER]: "user_1" }),
      config,
    );
    expect(result).toEqual({ ok: false, reason: "bad_secret" });
  });

  it("rejects a missing or malformed user id", () => {
    expect(authenticate(headers({ [GATEWAY_SECRET_HEADER]: SECRET }), config)).toEqual({
      ok: false,
      reason: "missing_user",
    });
    expect(
      authenticate(
        headers({ [GATEWAY_SECRET_HEADER]: SECRET, [USER_ID_HEADER]: "a b/../c" }),
        config,
      ),
    ).toEqual({ ok: false, reason: "bad_user" });
  });
});

describe("authenticate in dev mode", () => {
  const config = { mode: "dev" as const, devUserId: "dev-user" };

  it("uses the dev user by default and X-User-Id when sent", () => {
    expect(authenticate(headers({}), config)).toEqual({ ok: true, userId: "dev-user" });
    expect(authenticate(headers({ [USER_ID_HEADER]: "bob" }), config)).toEqual({
      ok: true,
      userId: "bob",
    });
  });
});
