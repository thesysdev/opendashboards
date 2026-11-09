import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AUTHORIZATION_HEADER,
  AuthConfigError,
  authenticate,
  createTokenVerifier,
  getAuthConfig,
  USER_ID_HEADER,
  type AuthConfig,
} from "@/lib/auth/verify";
import { DEFAULT_NEXT, safeNext } from "@/lib/auth/site";

const SUPABASE_URL = "https://project.supabase.co";
const USER = "6f1c2d3e-0000-4000-8000-000000000001";
const EMAIL = "ada@thesys.dev";
const ALLOWLIST = { domains: ["thesys.dev"], emails: ["guest@example.com"] };
const headers = (values: Record<string, string>) => new Headers(values);

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let keys: Keys;
let otherKeys: Keys;
let config: Extract<AuthConfig, { mode: "session" }>;

type TokenOptions = {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  subject?: string;
  expires?: string;
  signWith?: Keys;
};

function sign({ claims, issuer, audience, subject, expires, signWith }: TokenOptions = {}) {
  return new SignJWT({ role: "authenticated", email: EMAIL, user_metadata: { email_verified: true }, ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(audience ?? "authenticated")
    .setSubject(subject ?? USER)
    .setIssuedAt()
    .setExpirationTime(expires ?? "1h")
    .sign((signWith ?? keys).privateKey);
}

const request = (token: string) =>
  headers({ [AUTHORIZATION_HEADER]: `Bearer ${token}` });

beforeAll(async () => {
  keys = await generateKeyPair("ES256");
  otherKeys = await generateKeyPair("ES256");
  const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  config = {
    mode: "session",
    verifyToken: createTokenVerifier(SUPABASE_URL, createLocalJWKSet({ keys: [jwk] }), ALLOWLIST),
  };
});

describe("getAuthConfig", () => {
  const prod = { environment: "prod" as const, devUserId: null, supabaseUrl: SUPABASE_URL, allowlist: ALLOWLIST };

  it("uses sessions when Supabase is configured", () => {
    expect(getAuthConfig(prod)).toMatchObject({ mode: "session" });
    expect(getAuthConfig({ ...prod, environment: "local", devUserId: "dev-user" })).toMatchObject({ mode: "session" });
  });

  it("refuses prod without Supabase", () => {
    expect(() => getAuthConfig({ ...prod, supabaseUrl: undefined })).toThrow(AuthConfigError);
  });

  it("refuses an empty allowlist", () => {
    expect(() => getAuthConfig({ ...prod, allowlist: { domains: [], emails: [] } })).toThrow(AuthConfigError);
  });

  it("refuses a dev user outside local, even with Supabase", () => {
    expect(() => getAuthConfig({ ...prod, devUserId: "dev-user", supabaseUrl: undefined })).toThrow(AuthConfigError);
    expect(() => getAuthConfig({ ...prod, devUserId: "dev-user" })).toThrow(AuthConfigError);
  });

  it("uses local's dev user without Supabase", () => {
    expect(getAuthConfig({ environment: "local", devUserId: "alice", supabaseUrl: undefined, allowlist: { domains: [], emails: [] } })).toEqual({
      mode: "dev",
      devUserId: "alice",
    });
  });
});

describe("authenticate with a session", () => {
  it("takes the user from a valid token", async () => {
    await expect(authenticate(request(await sign()), config)).resolves.toEqual({ ok: true, userId: USER, email: EMAIL });
  });

  it("ignores X-User-Id", async () => {
    const forged = request(await sign());
    forged.set(USER_ID_HEADER, "someone-else");
    await expect(authenticate(forged, config)).resolves.toMatchObject({ ok: true, userId: USER });
  });

  it("rejects a missing or malformed Authorization header", async () => {
    await expect(authenticate(headers({}), config)).resolves.toEqual({ ok: false, reason: "missing_token" });
    await expect(authenticate(headers({ [AUTHORIZATION_HEADER]: "Basic abc" }), config)).resolves.toEqual({
      ok: false,
      reason: "missing_token",
    });
  });

  it("allows listed domains and single addresses, in any case", async () => {
    await expect(authenticate(request(await sign({ claims: { email: "Ada@THESYS.dev" } })), config)).resolves.toMatchObject({ ok: true });
    await expect(authenticate(request(await sign({ claims: { email: "guest@example.com" } })), config)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["an unlisted email", { email: "demo-user@gmail.com" }],
    ["a lookalike domain", { email: "x@notthesys.dev" }],
    ["a subdomain", { email: "x@evil.thesys.dev" }],
    ["no email", { email: undefined }],
    ["an unverified email", { user_metadata: { email_verified: false } }],
    ["no verification claim", { user_metadata: {} }],
  ])("refuses %s", async (_label, claims) => {
    await expect(authenticate(request(await sign({ claims })), config)).resolves.toEqual({ ok: false, reason: "not_allowed" });
  });

  it.each<[string, TokenOptions]>([
    ["expired", { expires: "-1m" }],
    ["signed by another key", {}],
    ["from another project", { issuer: "https://other.supabase.co/auth/v1" }],
    ["for another audience", { audience: "service" }],
    ["an anon-role token", { claims: { role: "anon" } }],
    ["an anonymous user's", { claims: { is_anonymous: true } }],
  ])("rejects a token that is %s", async (label, options) => {
    const token = await sign(label === "signed by another key" ? { signWith: otherKeys } : options);
    await expect(authenticate(request(token), config)).resolves.toEqual({ ok: false, reason: "bad_token" });
  });

  it("rejects an unsigned token", async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const payload = {
      sub: USER,
      role: "authenticated",
      email: EMAIL,
      user_metadata: { email_verified: true },
      iss: `${SUPABASE_URL}/auth/v1`,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = `${encode({ alg: "none" })}.${encode(payload)}.`;
    await expect(authenticate(request(token), config)).resolves.toEqual({ ok: false, reason: "bad_token" });
  });

  it("rejects a token whose subject isn't a valid user id", async () => {
    await expect(authenticate(request(await sign({ subject: "a b/../c" })), config)).resolves.toEqual({ ok: false, reason: "bad_user" });
  });

  it("reports an outage, not a bad token, when the keys can't be fetched", async () => {
    const unreachable = createTokenVerifier(
      SUPABASE_URL,
      async () => {
        throw new TypeError("fetch failed");
      },
      ALLOWLIST,
    );
    await expect(authenticate(request(await sign()), { ...config, verifyToken: unreachable })).resolves.toEqual({
      ok: false,
      reason: "auth_unavailable",
    });
  });
});

describe("safeNext", () => {
  it.each(["/apps", "/apps/1?tab=x"])("keeps %s", (path) => expect(safeNext(path)).toBe(path));
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/auth/login", "", null, "/a\nb"])("refuses %s", (path) =>
    expect(safeNext(path)).toBe(DEFAULT_NEXT),
  );
});

describe("authenticate in dev mode", () => {
  const dev = { mode: "dev" as const, devUserId: "dev-user" };

  it("uses the dev user by default and X-User-Id when sent", async () => {
    await expect(authenticate(headers({}), dev)).resolves.toEqual({ ok: true, userId: "dev-user" });
    await expect(authenticate(headers({ [USER_ID_HEADER]: "bob" }), dev)).resolves.toEqual({ ok: true, userId: "bob" });
  });
});
