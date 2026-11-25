import "server-only";

import type { Scope } from "@/lib/orgs/access";
import { signInOf } from "@/lib/sources/catalog";
import { isComposioSignIn } from "@/lib/sources/composio/catalog";

import { getConnectionService } from ".";
import { startComposioSignIn } from "./composio-sign-in";
import type { Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";

/**
 * Starts whichever sign-in a source uses: Composio's for Google Ads and Meta
 * Ads, the server's own OAuth for MCP servers. The same input either way: a
 * new connection, or `connectionId` to sign in to one that exists.
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  // A new connection: the sign-in its source uses now. One that exists: the sign-in it was made with.
  if (typeof fields?.source === "string" && signInOf(fields.source) === "composio") return startComposioSignIn(scope, input);
  if (typeof fields?.connectionId === "string") {
    const found = await getConnectionService().forSignIn(scope.userId, fields.connectionId);
    if (found.ok && isComposioSignIn(found.data.config)) return startComposioSignIn(scope, input);
  }
  return startMcpSignIn(scope, input);
}
