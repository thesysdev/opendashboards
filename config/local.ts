import type { EnvironmentSettings } from "./settings";

/** `next dev` and tests, on a developer's machine. */
export const local: EnvironmentSettings = {
  auth: { devUserId: "dev-user", publicHost: null },
  secrets: { allowPlaintext: true },
  kitPages: true,
  // Home and office networks are often slow, or have IPv6 that goes nowhere.
  network: { connectAttemptTimeoutMs: 2_000 },
};
