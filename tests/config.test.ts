import { describe, expect, it } from "vitest";

import {
  ConfigError,
  environment,
  secretProblems,
  settingsFor,
  settingsProblems,
  validateConfig,
  type Settings,
} from "@/config";

const SECRET = "s".repeat(40);
const PROD_SECRETS = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://db",
  THESYS_API_KEY: "key",
  GATEWAY_SHARED_SECRET: SECRET,
  KMS_KEY_ID: "kms",
};

/** prod's settings with some changed, as if someone edited prod.ts. */
const editedProd = (change: (settings: Settings) => void): Settings => {
  const settings = structuredClone(settingsFor("prod"));
  change(settings);
  return settings;
};

describe("environment", () => {
  it("follows Next.js's mode", () => {
    expect(environment({ NODE_ENV: "production" })).toBe("prod");
    expect(environment({ NODE_ENV: "development" })).toBe("local");
    expect(environment({ NODE_ENV: "test" })).toBe("local");
    expect(environment({})).toBe("local");
  });
});

describe("the settings files", () => {
  it("pass validation as shipped", () => {
    expect(settingsProblems("local", settingsFor("local"))).toEqual([]);
    expect(settingsProblems("prod", settingsFor("prod"))).toEqual([]);
  });

  it("change the connect timeout, allow a dev user, plaintext and /kit only locally", () => {
    const local = settingsFor("local");
    const prod = settingsFor("prod");
    expect(local.network.connectAttemptTimeoutMs).toBe(2_000);
    expect(prod.network.connectAttemptTimeoutMs).toBeNull();
    expect(local.auth.devUserId).toBe("dev-user");
    expect(prod.auth.devUserId).toBeNull();
    expect([local.secrets.allowPlaintext, prod.secrets.allowPlaintext]).toEqual([true, false]);
    expect([local.kitPages, prod.kitPages]).toEqual([true, false]);
  });

  it("share common settings", () => {
    expect(settingsFor("local").openui).toEqual(settingsFor("prod").openui);
  });
});

describe("settingsProblems", () => {
  it.each([
    ["a dev user", (s: Settings) => (s.auth.devUserId = "dev-user"), "auth.devUserId"],
    ["plaintext secrets", (s: Settings) => (s.secrets.allowPlaintext = true), "secrets.allowPlaintext"],
    ["the /kit pages", (s: Settings) => (s.kitPages = true), "kitPages"],
    ["a connect timeout", (s: Settings) => (s.network.connectAttemptTimeoutMs = 2_000), "connectAttemptTimeoutMs"],
  ])("refuses prod with %s", (_label, change, setting) => {
    const problems = settingsProblems("prod", editedProd(change));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(setting);
  });
});

describe("secretProblems", () => {
  it("accepts prod with every secret", () => {
    expect(secretProblems("prod", settingsFor("prod"), PROD_SECRETS)).toEqual([]);
  });

  it("names each missing secret prod needs", () => {
    const problems = secretProblems("prod", settingsFor("prod"), { NODE_ENV: "production" });
    expect(problems.join("\n")).toMatch(/DATABASE_URL[\s\S]*THESYS_API_KEY[\s\S]*GATEWAY_SHARED_SECRET[\s\S]*KMS_KEY_ID/);
  });

  it("refuses a short gateway secret", () => {
    expect(secretProblems("prod", settingsFor("prod"), { ...PROD_SECRETS, GATEWAY_SHARED_SECRET: "short" })).toEqual([
      "GATEWAY_SHARED_SECRET must be at least 32 characters",
    ]);
  });

  it("needs only the database and OpenUI key locally", () => {
    expect(secretProblems("local", settingsFor("local"), { DATABASE_URL: "postgres://db", THESYS_API_KEY: "key" })).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("checks secrets only when asked (a build machine needn't have them)", () => {
    expect(() => validateConfig({ withSecrets: false }, { NODE_ENV: "production" })).not.toThrow();
    expect(() => validateConfig({ withSecrets: true }, { NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => validateConfig({ withSecrets: true }, PROD_SECRETS)).not.toThrow();
  });
});
