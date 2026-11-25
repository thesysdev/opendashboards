import "server-only";

import { z } from "zod";

import type { Scope } from "@/lib/orgs/access";
import { isComposioSignIn } from "@/lib/sources/composio/catalog";

import { getConnectionService } from ".";
import { startComposioSignIn } from "./composio-sign-in";
import { fromValidation, type Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";

/**
 * What a sign-in is to, said outright by `kind`: a source people sign in to
 * themselves (Google Ads), a known MCP server, an MCP server at a URL, or a
 * connection that exists. The rest of each request is checked by the
 * sign-in that `kind` leads to.
 */
const requestSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("source") }),
  z.looseObject({ kind: z.literal("service") }),
  z.looseObject({ kind: z.literal("url") }),
  z.looseObject({ kind: z.literal("connection"), connectionId: z.string() }),
]);

/**
 * Starts whichever sign-in the request is for: Composio's for a source
 * people sign in to themselves (it refuses any source it doesn't run), the
 * server's own OAuth for an MCP server, and for a connection that exists,
 * the one its own config says it was made with.
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  const { kind, ...request } = parsed.data;
  switch (kind) {
    case "source":
      return startComposioSignIn(scope, request);
    case "service":
    case "url":
      return startMcpSignIn(scope, request);
    case "connection": {
      const found = await getConnectionService().forSignIn(scope.userId, parsed.data.connectionId);
      // Not found (or not theirs): the MCP sign-in looks again and says so.
      return found.ok && isComposioSignIn(found.data.config) ? startComposioSignIn(scope, request) : startMcpSignIn(scope, request);
    }
  }
}
