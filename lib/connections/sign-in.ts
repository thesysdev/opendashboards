import "server-only";

import type { Scope } from "@/lib/orgs/access";

import { getConnectionService } from ".";
import { isComposioType, startComposioSignIn } from "./composio-sign-in";
import type { Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";

/**
 * Starts whichever sign-in a source uses: Composio's for Google Ads and Meta
 * Ads, the server's own OAuth for MCP servers. The same input either way: a
 * new connection, or `connectionId` to sign in to one that exists.
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  if (typeof fields?.source === "string" && isComposioType(fields.source)) return startComposioSignIn(scope, input);
  if (typeof fields?.connectionId === "string") {
    const found = await getConnectionService().forSignIn(scope.userId, fields.connectionId);
    if (found.ok && isComposioType(found.data.config.type)) return startComposioSignIn(scope, input);
  }
  return startMcpSignIn(scope, input);
}
