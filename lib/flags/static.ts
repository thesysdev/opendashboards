import type { Flag, FlagProvider } from "./types";

/** Every flag on, except those in `off`: local development, self-hosted installs and tests. */
export function createStaticFlags(off: readonly Flag[] = []): FlagProvider {
  return { provider: "static", isEnabled: async (flag) => !off.includes(flag) };
}
