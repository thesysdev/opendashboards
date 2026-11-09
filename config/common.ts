import type { CommonSettings } from "./settings";

/** Settings that are the same locally and in production. */
export const common: CommonSettings = {
  openui: {
    apiUrl: "https://api.thesys.dev",
    gatewayUrl: "https://api.thesys.dev/v1/embed",
    model: "anthropic/claude-sonnet-5.5",
    maxAgentRounds: 24,
  },
  posthog: { queryTimeoutMs: 50_000, checkTimeoutMs: 15_000, maxRows: { agent: 200, dashboard: 10_000 } },
  kms: { region: "us-east-1" },
  postgres: { connectTimeoutMs: 5_000, statementTimeoutMs: 15_000, maxRows: { agent: 200, dashboard: 10_000 } },
};
