import { common } from "./common";
import { local } from "./local";
import { prod } from "./prod";
import type { Environment, EnvironmentSettings, Settings } from "./settings";

export { ENVIRONMENTS, type Environment, type Settings } from "./settings";

/**
 * Prism's configuration, in one place. The environment follows Next.js's
 * mode: production builds and `next start` run as prod, `next dev` and tests
 * as local. Settings come from common.ts plus that environment's file.
 *
 * Secrets stay in environment variables and are read only here.
 * validateConfig() runs from next.config.ts, so an invalid configuration
 * stops `next dev`, `next build` or `next start` before anything is served.
 */

const ENVIRONMENT_SETTINGS: Record<Environment, EnvironmentSettings> = { local, prod };

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Which environment this process runs as. */
export function environment(env: Env = process.env): Environment {
  return env.NODE_ENV === "production" ? "prod" : "local";
}

/** The settings for an environment. */
export function settingsFor(name: Environment): Settings {
  return { ...common, ...ENVIRONMENT_SETTINGS[name] };
}

/** This process's settings. */
export function config(): Settings & { env: Environment } {
  const env = environment();
  return { env, ...settingsFor(env) };
}

/** Secrets, from environment variables only. Never logged, never in settings files. */
export const secrets = {
  /** Prism's own database. */
  databaseUrl: () => process.env.DATABASE_URL,
  /** OpenUI Cloud and Gateway. */
  thesysApiKey: () => process.env.THESYS_API_KEY,
  /** Seals data-source keys with AWS KMS. */
  kmsKeyId: () => process.env.KMS_KEY_ID,
  /** The AWS role Vercel OIDC assumes to use that key. Not secret, but set per deployment. */
  kmsRoleArn: () => process.env.KMS_ROLE_ARN,
  /** The Supabase project that signs users in. Not secret, but set per deployment. */
  supabaseUrl: () => process.env.SUPABASE_URL,
  supabasePublishableKey: () => process.env.SUPABASE_PUBLISHABLE_KEY,
  /** Who may use Prism: whole email domains, and single addresses. */
  allowedDomains: () => parseList(process.env.PRISM_ALLOWED_DOMAINS),
  allowedEmails: () => parseList(process.env.PRISM_ALLOWED_EMAILS),
};

function parseList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

/**
 * What can't be true of an environment's settings. Only local may act as a
 * user without signing in, store keys unencrypted, serve the /kit pages or
 * change Node's connection defaults.
 */
export function settingsProblems(name: Environment, settings: Settings): string[] {
  if (name === "local") return [];
  const problems: string[] = [];
  if (settings.auth.devUserId !== null) problems.push(`${name}: auth.devUserId must be null; only local may skip sign-in`);
  if (settings.secrets.allowPlaintext) problems.push(`${name}: secrets.allowPlaintext must be false; keys are never stored unencrypted outside local`);
  if (settings.kitPages) problems.push(`${name}: kitPages must be false; the /kit pages are for local development`);
  if (settings.network.connectAttemptTimeoutMs !== null) {
    problems.push(`${name}: network.connectAttemptTimeoutMs must be null; only local changes Node's connection defaults`);
  }
  return problems;
}

/** Which secrets an environment's settings need, and which are missing or invalid. */
export function secretProblems(name: Environment, settings: Settings, env: Env = process.env): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  if (!env.THESYS_API_KEY) problems.push("THESYS_API_KEY is not set");
  if (settings.auth.devUserId === null) {
    if (!env.SUPABASE_URL) problems.push(`SUPABASE_URL is not set; ${name} has no dev user, so requests must sign in`);
    if (!env.SUPABASE_PUBLISHABLE_KEY) problems.push("SUPABASE_PUBLISHABLE_KEY is not set");
    if (!parseList(env.PRISM_ALLOWED_DOMAINS).length && !parseList(env.PRISM_ALLOWED_EMAILS).length) {
      problems.push("PRISM_ALLOWED_DOMAINS or PRISM_ALLOWED_EMAILS must be set; nobody could sign in");
    }
  }
  if (!settings.secrets.allowPlaintext && !env.KMS_KEY_ID) {
    problems.push(`KMS_KEY_ID is not set; ${name} never stores keys unencrypted`);
  }
  if (!settings.secrets.allowPlaintext && !env.KMS_ROLE_ARN) {
    problems.push(`KMS_ROLE_ARN is not set; ${name} reaches KMS through Vercel OIDC`);
  }
  return problems;
}

/**
 * Checks this process's configuration and throws a ConfigError listing every
 * problem. The settings rules apply always, including `next build`, so a bad
 * settings file fails the build. Secrets are checked only where a server is
 * about to start (`withSecrets`), since a build machine needn't have them.
 */
export function validateConfig({ withSecrets }: { withSecrets: boolean }, env: Env = process.env): void {
  const name = environment(env);
  const settings = settingsFor(name);
  const problems = [...settingsProblems(name, settings), ...(withSecrets ? secretProblems(name, settings, env) : [])];
  if (problems.length) {
    throw new ConfigError(`Invalid ${name} configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }
}
