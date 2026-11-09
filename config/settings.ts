/**
 * Every setting Prism has. common.ts sets the ones that are the same
 * everywhere; local.ts and prod.ts set the ones that differ. index.ts picks
 * by Next.js's mode and checks them. Secrets are never here: they stay in
 * environment variables, read in index.ts.
 */

/** local: `next dev` and tests. prod: production builds and `next start`. */
export const ENVIRONMENTS = ["local", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** The same in every environment. */
export type CommonSettings = {
  openui: {
    /** OpenUI Cloud's API: artifacts, conversations, frontend tokens. */
    apiUrl: string;
    /** OpenUI Gateway, for the Build agent's model calls. */
    gatewayUrl: string;
    /** The model that runs the Build agent and builds dashboards. */
    model: string;
    /** Model rounds per Build turn, tool calls included. */
    maxAgentRounds: number;
  };
  posthog: {
    /** A dashboard or agent query; inside the dashboard interpreter's 60-second budget. */
    queryTimeoutMs: number;
    /** Checking a connection when it's added or retested. */
    checkTimeoutMs: number;
    /** Rows a query may return: the agent reads results, dashboards draw them. */
    maxRows: { agent: number; dashboard: number };
  };
  kms: {
    /** Where the KMS key that seals data-source credentials lives. */
    region: string;
  };
  postgres: {
    connectTimeoutMs: number;
    statementTimeoutMs: number;
    maxRows: { agent: number; dashboard: number };
  };
};

/** Different per environment. */
export type EnvironmentSettings = {
  auth: {
    /**
     * Who requests are for when no gateway sits in front of the app (an
     * X-User-Id header can still override it). null: every request must come
     * through the gateway, with GATEWAY_SHARED_SECRET. Local only.
     */
    devUserId: string | null;
    /**
     * The host people use Prism at, when a gateway sits in front of it.
     * Cross-site checks accept it alongside the request's own host.
     */
    publicHost: string | null;
  };
  secrets: {
    /** Store data-source keys unencrypted when no KMS key is configured. Local only. */
    allowPlaintext: boolean;
  };
  /** The /kit pages: the dashboard kit's gallery, edge cases and mock dashboards. */
  kitPages: boolean;
  network: {
    /**
     * How long Node waits on each of a host's addresses before trying the
     * next when it opens a connection. null keeps Node's default (250ms),
     * which fails outright on a slow link where IPv6 is unreachable.
     */
    connectAttemptTimeoutMs: number | null;
  };
};

export type Settings = CommonSettings & EnvironmentSettings;
