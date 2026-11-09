import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`. */
export const prod: EnvironmentSettings = {
  auth: { devUserId: null },
  limits: { chatTurnsPerUserPerDay: 25, chatTurnsPerDay: 1000 },
  secrets: { allowPlaintext: false },
  kitPages: false,
  network: { connectAttemptTimeoutMs: null },
};
