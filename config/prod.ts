import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`. */
export const prod: EnvironmentSettings = {
  auth: { devUserId: null },
  secrets: { allowPlaintext: false },
  kitPages: false,
  network: { connectAttemptTimeoutMs: null },
};
