import "server-only";

import type { Scope } from "@/lib/orgs/access";
import { hiddenSources } from "@/lib/sources/flags";

import { getConnectionService } from ".";
import { isComposioToolkit } from "@/lib/sources/composio/catalog";

import { startComposioSignIn } from "./composio-sign-in";
import { fail, type Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";

/**
 * Starts whichever sign-in a source uses: Composio's for Google Ads and Meta
 * Ads, the server's own OAuth for MCP servers. The same input either way: a
 * new connection, or `connectionId` to sign in to one that exists.
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  if (typeof fields?.source === "string" && isComposioToolkit(fields.source)) {
    // Not rolled out to this person or workspace: it can't be added (one already added can still sign in again).
    if ((await hiddenSources(scope)).includes(fields.source)) {
      return fail({ code: "not_available", message: "This source isn't available in this workspace yet." });
    }
    return startComposioSignIn(scope, input);
  }
  if (typeof fields?.connectionId === "string") {
    const found = await getConnectionService().forSignIn(scope.userId, fields.connectionId);
    if (found.ok && isComposioToolkit(found.data.config.type)) return startComposioSignIn(scope, input);
  }
  return startMcpSignIn(scope, input);
}
