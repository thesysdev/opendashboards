import "server-only";

import { z } from "zod";

import type { Scope } from "@/lib/orgs/access";
import { signInOf } from "@/lib/sources/catalog";

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

type Started = Result<{ authorizationUrl: string; existing: string | null }>;

/** Each way of signing in, by the provider a source's catalog or a saved connection's config names. */
const START = {
  composio: startComposioSignIn,
  mcp: startMcpSignIn,
} satisfies Record<string, (scope: Scope, input: unknown) => Promise<Started>>;

type Provider = keyof typeof START;

/** The sign-in a saved connection was made with, as its own config recorded it. An MCP server's records none: its own OAuth. */
function providerOf(config: object): Provider {
  const oauth = "oauth" in config ? config.oauth : undefined;
  const provider = typeof oauth === "object" && oauth !== null && "provider" in oauth ? oauth.provider : undefined;
  return typeof provider === "string" && Object.hasOwn(START, provider) ? (provider as Provider) : "mcp";
}

/**
 * Starts whichever sign-in the request is for: a new connection signs in the
 * way its source does now (its catalog says), a known or typed-in MCP server
 * with its own OAuth, and a connection that exists the way it was made (its
 * own config says).
 */
export async function startSignIn(scope: Scope, input: unknown): Promise<Started> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  const { kind, ...request } = parsed.data;
  switch (kind) {
    case "source": {
      const provider = signInOf(parsed.data.source);
      if (!provider) return fail({ code: "validation", message: "This source doesn't connect by signing in." });
      return START[provider](scope, request);
    }
    case "service":
    case "url":
      return START.mcp(scope, request);
    case "connection": {
      const found = await getConnectionService().forSignIn(scope.userId, parsed.data.connectionId);
      // Not found (or not theirs): the MCP sign-in looks again and says so.
      return START[found.ok ? providerOf(found.data.config) : "mcp"](scope, request);
    }
  }
}
