import "server-only";

import { z } from "zod";

import type { Scope } from "@/lib/orgs/access";
import { signInOf } from "@/lib/sources/catalog";
import { isComposioSignIn } from "@/lib/sources/composio/catalog";

import { getConnectionService } from ".";
import { startComposioSignIn } from "./composio-sign-in";
import { fail, fromValidation, type Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";

/**
 * What a sign-in is to, said outright by `kind`: a source people sign in to
 * themselves (Google Ads), a known MCP server, an MCP server at a URL, or a
 * connection that exists. The rest of each request is checked by the
 * sign-in that `kind` leads to.
 */
const requestSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("source"), source: z.string() }),
  z.looseObject({ kind: z.literal("service") }),
  z.looseObject({ kind: z.literal("url") }),
  z.looseObject({ kind: z.literal("connection"), connectionId: z.string() }),
]);

/**
 * Starts whichever sign-in the request is for: Composio's for a source that
 * signs in through it, the server's own OAuth for an MCP server. A
 * connection that exists signs in the way it was made (its own config says).
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  const { kind, ...request } = parsed.data;
  switch (kind) {
    case "source":
      if (signInOf(parsed.data.source) === "composio") return startComposioSignIn(scope, request);
      return fail({ code: "validation", message: "This source doesn't connect by signing in." });
    case "service":
    case "url":
      return startMcpSignIn(scope, request);
    case "connection": {
      const found = await getConnectionService().forSignIn(scope.userId, parsed.data.connectionId);
      if (found.ok && isComposioSignIn(found.data.config)) return startComposioSignIn(scope, request);
      return startMcpSignIn(scope, request);
    }
  }
}
