import { common } from "./common";
import { local } from "./local";
import { plansFromEnv } from "./plans";
import { prod } from "./prod";
import type { Environment, EnvironmentSettings, Settings } from "./settings";

export {
  ENVIRONMENTS,
  type CatalogPlan,
  type DemoData,
  type DemoDataset,
  type Environment,
  type PlansSettings,
  type Settings,
  type StripePlan,
} from "./settings";

/**
 * OpenDashboards' configuration, in one place. The environment follows Next.js's
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
export function settingsFor(name: Environment, env: Env = process.env): Settings {
  const envSettings = ENVIRONMENT_SETTINGS[name];
  return { ...common, ...envSettings, plans: envSettings.plans ?? plansFromEnv(env) };
}

/** This process's settings. */
export function config(env: Env = process.env): Settings & { env: Environment } {
  const name = environment(env);
  return { env: name, ...settingsFor(name, env) };
}

/** Secrets, from environment variables only. Never logged, never in settings files. */
export const secrets = {
  /** Our database: OpenDashboards' own Neon project. The only database we write to or migrate. */
  databaseUrl: () => process.env.DATABASE_URL,
  /** The same database's direct (unpooled) URL, for migrations. Set by Neon on Vercel. */
  databaseUrlUnpooled: () => process.env.DATABASE_URL_UNPOOLED,
  /** OpenUI Cloud and Gateway. */
  thesysApiKey: () => process.env.THESYS_API_KEY,
  /** Seals data-source keys with AWS KMS. */
  kmsKeyId: () => process.env.KMS_KEY_ID,
  /** The AWS role Vercel OIDC assumes to use that key. Not secret, but set per deployment. */
  kmsRoleArn: () => process.env.KMS_ROLE_ARN,
  /** The Supabase project whose JWTs say who a request is for. Not secret, but set per deployment. */
  supabaseUrl: () => process.env.SUPABASE_URL,
  /** Demo data: the password of the Demo Data project's read-only role. Unset locally: no demo datasets. */
  demoDataPassword: () => process.env.DEMO_DATABASE_PASSWORD,
  /** Stripe's API key. Needed only when settings have plans. */
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY,
  /** Verifies that webhook events came from Stripe. */
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
};

/**
 * What can't be true of an environment's settings. Only local may act as a
 * user without the gateway, store keys unencrypted or
 * change Node's connection defaults.
 */
export function settingsProblems(name: Environment, settings: Settings): string[] {
  const problems = [...demoDatasetProblems(settings), ...planProblems(settings)];
  if (settings.mcpClientMetadataDocument && !/^https:\/\/[^/]+$/.test(settings.appOrigin)) {
    problems.push(`${name}: mcpClientMetadataDocument needs an https:// appOrigin, which authorization servers can fetch from`);
  }
  if (name === "local") return problems;
  if (settings.auth.devUser !== null) problems.push(`${name}: auth.devUser must be null; only local may skip the gateway`);
  if (settings.auth.publicHost === null) problems.push(`${name}: auth.publicHost must be set; it sits behind the gateway`);
  if (!/^https:\/\/[^/]+$/.test(settings.appOrigin)) problems.push(`${name}: appOrigin must be an https:// origin, without a path`);
  if (settings.secrets.allowPlaintext) problems.push(`${name}: secrets.allowPlaintext must be false; keys are never stored unencrypted outside local`);
  if (settings.network.connectAttemptTimeoutMs !== null) {
    problems.push(`${name}: network.connectAttemptTimeoutMs must be null; only local changes Node's connection defaults`);
  }
  return problems;
}

const DEMO_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Demo datasets need unique, stable keys and somewhere sensible to point. */
function demoDatasetProblems(settings: Settings): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const dataset of settings.demoData.datasets) {
    const label = `demoData.${dataset.key || "?"}`;
    if (!DEMO_KEY.test(dataset.key)) problems.push(`${label}: key must be lowercase letters, digits or _ (at most 40)`);
    if (seen.has(dataset.key)) problems.push(`${label}: key is used twice`);
    seen.add(dataset.key);
    if (!dataset.name.trim()) problems.push(`${label}: name is empty`);
    if (!dataset.description.trim()) problems.push(`${label}: description is empty`);
    if (!dataset.summary.trim()) problems.push(`${label}: summary is empty`);
    const { host, port, database, user } = dataset.postgres;
    if (!host.trim() || !database.trim() || !user.trim()) problems.push(`${label}: postgres needs a host, database and user`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`${label}: postgres.port must be 1–65535`);
  }
  return problems;
}

/**
 * A plan catalog needs its free plan, Stripe ids on every paid plan and none
 * on the free one, and limits that are whole numbers. (A missing or
 * mistyped entitlement doesn't compile.)
 */
function planProblems(settings: Settings): string[] {
  const { plans } = settings;
  if (!plans) return [];
  const problems: string[] = [];
  const free = plans.catalog[plans.free];
  if (!free) problems.push(`plans.free: "${plans.free}" isn't in the catalog`);
  else if (free.stripe) problems.push(`plans.free: the free plan can't have Stripe prices`);
  for (const [id, plan] of Object.entries(plans.catalog)) {
    const label = `plans.catalog.${id}`;
    if (!plan.name.trim()) problems.push(`${label}: name is empty`);
    if (id !== plans.free) {
      const ids = plan.stripe ? [plan.stripe.monthly, plan.stripe.annual, plan.stripe.portal.month, plan.stripe.portal.year] : [];
      if (ids.length === 0 || ids.some((value) => !value.trim())) problems.push(`${label}: a paid plan needs its Stripe prices and portal configurations`);
      if (plan.perSeat && !plan.stripe?.portal.seats?.trim()) problems.push(`${label}: a per-seat plan needs its seats portal configuration`);
    }
    for (const [entitlement, value] of Object.entries(plan.entitlements)) {
      if ("max" in value && value.max !== null && (!Number.isInteger(value.max) || value.max < 1)) {
        problems.push(`${label}.${entitlement}: max must be a whole number of 1 or more, or null`);
      }
    }
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(plans.supportEmail)) problems.push("plans.supportEmail must be an email address");
  return problems;
}

/** Which secrets an environment's settings need, and which are missing or invalid. */
export function secretProblems(name: Environment, settings: Settings, env: Env = process.env): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  if (!env.THESYS_API_KEY) problems.push("THESYS_API_KEY is not set");
  if (settings.auth.devUser === null && !env.SUPABASE_URL) {
    problems.push(`SUPABASE_URL is not set; ${name} has no dev user, so requests must carry a verified token`);
  }
  if (!settings.secrets.allowPlaintext && !env.KMS_KEY_ID) {
    problems.push(`KMS_KEY_ID is not set; ${name} never stores keys unencrypted`);
  }
  if (!settings.secrets.allowPlaintext && !env.KMS_ROLE_ARN) {
    problems.push(`KMS_ROLE_ARN is not set; ${name} reaches KMS through Vercel OIDC`);
  }
  // Locally, demo datasets are optional: without the password they're simply not offered.
  if (name !== "local" && settings.demoData.datasets.length && !env.DEMO_DATABASE_PASSWORD) {
    problems.push(`DEMO_DATABASE_PASSWORD is not set; ${name} offers demo datasets`);
  }
  if (settings.plans && !env.STRIPE_SECRET_KEY) problems.push(`STRIPE_SECRET_KEY is not set; ${name} has paid plans`);
  if (settings.plans && !env.STRIPE_WEBHOOK_SECRET) problems.push(`STRIPE_WEBHOOK_SECRET is not set; ${name} has paid plans`);
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
  const settings = settingsFor(name, env);
  const problems = [...settingsProblems(name, settings), ...(withSecrets ? secretProblems(name, settings, env) : [])];
  if (problems.length) {
    throw new ConfigError(`Invalid ${name} configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }
}
