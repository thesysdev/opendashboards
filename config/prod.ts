import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`, behind the gateway. */
export const prod: EnvironmentSettings = {
  auth: { devUserId: null },
  secrets: { allowPlaintext: false },
  kitPages: false,
  network: { connectAttemptTimeoutMs: null },
};
