import type { ConnectionSharing } from "@/lib/db/schema";
import type { ConnectionKind } from "@/lib/orgs/policy";

/** Whether a stored connection signs in with OAuth (its tokens are in `connection_sign_ins`), rather than using a key. */
export function isSignIn(config: unknown): boolean {
  return Boolean(config && typeof config === "object" && "oauth" in config && (config as { oauth?: unknown }).oauth);
}

/** What a stored connection is, fixed when it was added. A demo dataset counts as a key: the workspace's own. */
export function connectionKind(row: { config: unknown; sharing: ConnectionSharing; demoDataset: string | null }): ConnectionKind {
  if (row.demoDataset !== null || !isSignIn(row.config)) return "key";
  return row.sharing === "org" ? "signInShared" : "signInEach";
}
