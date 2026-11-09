import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, safeNext } from "@/lib/auth/site";
import { AuthConfigError, checkClaims, devUser, getAuthConfig, USER_ID_HEADER } from "@/lib/auth/verify";

const USER = "6f1c2d3e-0000-4000-8000-000000000001";
const ALLOWLIST = { domains: ["thesys.dev"], emails: ["guest@example.com"] };
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: USER,
  aud: "authenticated",
  role: "authenticated",
  email: "ada@thesys.dev",
  user_metadata: { email_verified: true },
  ...extra,
});

describe("getAuthConfig", () => {
  const prod = { environment: "prod" as const, devUserId: null, supabaseUrl: "https://p.supabase.co", allowlist: ALLOWLIST };
  const none = { domains: [], emails: [] };

  it("uses sessions when Supabase is configured", () => {
    expect(getAuthConfig(prod)).toEqual({ mode: "session", allowlist: ALLOWLIST });
    expect(getAuthConfig({ ...prod, environment: "local", devUserId: "dev-user" }).mode).toBe("session");
  });

  it("refuses prod without Supabase, an empty allowlist, or a dev user", () => {
    expect(() => getAuthConfig({ ...prod, supabaseUrl: undefined })).toThrow(AuthConfigError);
    expect(() => getAuthConfig({ ...prod, allowlist: none })).toThrow(AuthConfigError);
    expect(() => getAuthConfig({ ...prod, devUserId: "dev-user" })).toThrow(AuthConfigError);
  });

  it("uses local's dev user without Supabase", () => {
    expect(getAuthConfig({ environment: "local", devUserId: "alice", supabaseUrl: undefined, allowlist: none })).toEqual({
      mode: "dev",
      devUserId: "alice",
    });
  });
});

describe("checkClaims", () => {
  it("accepts a verified, allowlisted user", () => {
    expect(checkClaims(claims(), ALLOWLIST)).toEqual({ ok: true, userId: USER, email: "ada@thesys.dev" });
  });

  it("allows listed domains and single addresses, in any case", () => {
    expect(checkClaims(claims({ email: "Ada@THESYS.dev" }), ALLOWLIST).ok).toBe(true);
    expect(checkClaims(claims({ email: "guest@example.com" }), ALLOWLIST).ok).toBe(true);
  });

  it("treats no session as signed out", () => {
    expect(checkClaims(null, ALLOWLIST)).toEqual({ ok: false, reason: "signed_out" });
  });

  it.each([
    ["an unlisted email", { email: "demo-user@gmail.com" }],
    ["a lookalike domain", { email: "x@notthesys.dev" }],
    ["a subdomain", { email: "x@evil.thesys.dev" }],
    ["no email", { email: undefined }],
    ["an unverified email", { user_metadata: { email_verified: false } }],
    ["no verification claim", { user_metadata: {} }],
  ])("refuses %s", (_label, extra) => {
    expect(checkClaims(claims(extra), ALLOWLIST)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it.each([
    ["an anon-role token", { role: "anon" }],
    ["another audience", { aud: "service" }],
    ["an anonymous user", { is_anonymous: true }],
  ])("rejects %s", (_label, extra) => {
    expect(checkClaims(claims(extra), ALLOWLIST)).toEqual({ ok: false, reason: "bad_token" });
  });

  it("rejects a subject that isn't a valid user id", () => {
    expect(checkClaims(claims({ sub: "a b/../c" }), ALLOWLIST)).toEqual({ ok: false, reason: "bad_user" });
  });
});

describe("devUser", () => {
  it("uses the dev user by default and X-User-Id when sent", () => {
    expect(devUser(new Headers(), "dev-user")).toEqual({ ok: true, userId: "dev-user" });
    expect(devUser(new Headers({ [USER_ID_HEADER]: "bob" }), "dev-user")).toEqual({ ok: true, userId: "bob" });
  });
});

describe("safeNext", () => {
  it.each(["/apps", "/apps/1?tab=x"])("keeps %s", (path) => expect(safeNext(path)).toBe(path));
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/auth/login", "", null, "/a\nb"])("refuses %s", (path) =>
    expect(safeNext(path)).toBe(DEFAULT_NEXT),
  );
});
