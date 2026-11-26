import "server-only";

import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { config as appConfig } from "@/config";
import { track } from "@/lib/analytics";
import { logError } from "@/lib/log";
import type { Scope } from "@/lib/orgs/access";
import { sourceFor } from "@/lib/sources";
import { CONNECTION_TYPES, connectionConfigSchema, type ConnectionConfig, type ConnectionType } from "@/lib/sources/catalog";
import { hashState, isState, newState, SignInRefused } from "@/lib/sources/sign-in";
import type { ConnectionSource, SourceSignIn } from "@/lib/sources/types";

import { getConnectionService } from ".";
import { fail, fromCheckError, fromValidation, internalError, notFound, ok, type Result } from "./errors";
import { startMcpSignIn } from "./mcp-sign-in";
import { connectionNameSchema, RETURN_PATH } from "./schemas";
import type { ConnectionService } from "./service";

/**
 * Connecting a source by signing in instead of with a key: a new connection,
 * or signing in to one that exists. The source runs its own sign-in page
 * (its `signIn`); this runs the rest the same way for every source: who may
 * start one, keeping it until the browser comes back, and saving what it
 * got. Nothing here names a source.
 *
 * MCP servers still sign in their own way (lib/connections/mcp-sign-in.ts):
 * the two places marked below send them there until they move here.
 */

/**
 * Where every sign-in comes back to. The state is a path segment, so nothing
 * a sign-in page appends to the URL can disturb it. (An MCP server's comes
 * back to the URL registered with it instead, with the state in the query.)
 */
export const signInCallbackUrl = (state: string) => `${appConfig().appOrigin}/api/sign-in/callback/${state}`;

/** How a new connection is used, fixed once added: each member signs in themselves unless it's shared. */
const sharing = z.enum(["personal", "org"]).default("personal");

/** A new connection: its source, name and sharing, and the source's own settings. */
const newSchema = z.looseObject({ type: z.enum(CONNECTION_TYPES), name: connectionNameSchema, sharing });

/** A connection that exists, and the dashboard to go back to, if it was started from one. */
const existingSchema = z.object({ connectionId: z.uuid(), returnTo: z.string().regex(RETURN_PATH).optional() }).strict();

type Deps = { service?: ConnectionService; sources?: (type: ConnectionType) => ConnectionSource };

type Started = Result<{ authorizationUrl: string; /** MCP only: the connection it signs in to instead. */ existing?: string | null }>;

/** Starts a sign-in to a new connection. Returns the page to send the browser to. */
export async function startNewSignIn(scope: Scope, input: unknown, deps: Deps = {}): Promise<Started> {
  const parsed = newSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  const { type, name, sharing: sharingOf, ...settings } = parsed.data;
  // MCP: its own sign-in, until it moves here.
  if (type === "mcp") return startMcpSignIn(scope, { name, sharing: sharingOf, ...settings });

  const source = (deps.sources ?? sourceFor)(type);
  if (!source.signIn) return fail({ code: "validation", message: `${source.label} connects with a key, not by signing in.` });
  const config = connectionConfigSchema.safeParse({ ...settings, type });
  if (!config.success) return fromValidation(config.error);
  // Another personal one is added under a name of its own: two alike can't be told apart in dashboards or by the agent.
  if (sharingOf === "personal") {
    const existing = await (deps.service ?? getConnectionService()).personalSignInConnections(scope, type);
    if (existing.some((connection) => sameName(connection.name, name))) {
      return fail({ code: "name_taken", field: "name", message: `There's already a ${source.label} connection called ${name}. Sign in to it, or pick another name.` });
    }
  }
  return begin(scope, source.signIn, { connectionId: null, name, sharing: sharingOf, config: config.data }, deps);
}

/** Starts a sign-in to a connection that exists: as the caller, or for a shared one, as the one everyone runs as. */
export async function startSignInTo(scope: Scope, input: unknown, deps: Deps = {}): Promise<Started> {
  const parsed = existingSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  const found = await (deps.service ?? getConnectionService()).forSignIn(scope.userId, parsed.data.connectionId);
  if (!found.ok) return found;
  const { id, orgId, name, config } = found.data;
  const signIn = (deps.sources ?? sourceFor)(config.type).signIn;
  if (!signIn) {
    // MCP: its own sign-in, until it moves here.
    return config.type === "mcp" ? startMcpSignIn(scope, parsed.data) : notFound();
  }
  // In the workspace that connection is in, whichever one the caller has open.
  return begin({ userId: scope.userId, orgId }, signIn, { connectionId: id, name, sharing: "personal", config, returnTo: parsed.data.returnTo }, deps);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const typeSchema = z.object({ type: z.enum(CONNECTION_TYPES) }).strict();

/**
 * The workspace's personal connections of a source, for someone adding it
 * again to choose between signing in to one of them and adding another. Only
 * for sources that sign in here: MCP servers still join theirs on their own.
 */
export async function personalSignIns(scope: Scope, input: unknown, deps: Deps = {}): Promise<Result<{ id: string; name: string; signedIn: boolean }[]>> {
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);
  if (!(deps.sources ?? sourceFor)(parsed.data.type).signIn) return ok([]);
  return ok(await (deps.service ?? getConnectionService()).personalSignInConnections(scope, parsed.data.type));
}

async function begin(
  scope: Scope,
  signIn: SourceSignIn<Record<string, unknown>>,
  sign: { connectionId: string | null; name: string; sharing: "personal" | "org"; config: ConnectionConfig; returnTo?: string },
  deps: Deps,
): Promise<Started> {
  const service = deps.service ?? getConnectionService();
  try {
    const state = newState();
    const { type: _type, ...settings } = sign.config;
    const started = await signIn.start({ config: settings, callbackUrl: signInCallbackUrl(state) });
    const saved = await service.startSignIn(scope, { ...sign, stateHash: hashState(state), pending: started.pending });
    if (!saved.ok) {
      discard(signIn, started.pending);
      return saved;
    }
    return ok({ authorizationUrl: started.url });
  } catch (error) {
    return failure("start", error);
  }
}

/** Where a sign-in started, to go back to however it ended. Null when it isn't known which sign-in it was. */
export type StartedFrom = { orgId: string | null; returnTo: string | null };

export type Finished = Result<{ id: string }> & { from: StartedFrom | null };

/** Finishes a sign-in when the browser comes back, with the callback's state and query parameters. */
export async function finishSignIn(userId: string, state: string | null, params: URLSearchParams, deps: Deps = {}): Promise<Finished> {
  const service = deps.service ?? getConnectionService();
  if (!state || !isState(state)) return { ...fail({ code: "oauth_failed", message: "The sign-in came back without its state. Start again." }), from: null };

  // Taken once, for this user only, before it expires: a replayed or someone else's callback finds nothing.
  const taken = await service.takeSignIn(userId, hashState(state));
  if (!taken) {
    return { ...fail({ code: "oauth_expired", message: "This sign-in expired or was already used. Start it again from Data Connections." }), from: null };
  }
  // Checked again on the way out: only our own app paths, ever.
  const from: StartedFrom = { orgId: taken.orgId, returnTo: taken.returnTo && RETURN_PATH.test(taken.returnTo) ? taken.returnTo : null };
  const finished = (outcome: "done" | "denied" | "failed", errorCode: string | null = null) =>
    track(userId, "connection_sign_in_finished", { source_type: taken.config.type, outcome, error_code: errorCode, renewal: taken.connectionId !== null }, taken.orgId);

  const signIn = (deps.sources ?? sourceFor)(taken.config.type).signIn;
  // Only a source with a sign-in started one here.
  if (!signIn) return { ...internalError(), from };
  try {
    const { type: _type, ...settings } = taken.config;
    const credential = await signIn.finish({ config: settings, pending: taken.pending, params });
    const saved = await service.saveSignedIn(userId, {
      orgId: taken.orgId,
      connectionId: taken.connectionId,
      sharing: taken.sharing,
      name: taken.name,
      config: taken.config,
      credential,
    });
    finished(saved.ok ? "done" : "failed", saved.ok ? null : saved.error.code);
    if (!saved.ok) {
      discard(signIn, taken.pending);
      return { ...saved, from };
    }
    return { ...ok({ id: saved.data.id }), from };
  } catch (error) {
    discard(signIn, taken.pending);
    if (error instanceof SignInRefused) {
      finished(error.outcome, error.code);
      return { ...fail({ code: "oauth_failed", message: "The sign-in didn't complete. Try again." }), from };
    }
    const result = failure("finish", error);
    finished("failed", result.ok ? null : result.error.code);
    return { ...result, from };
  }
}

/**
 * Lets go of what a sign-in that didn't become a connection made elsewhere.
 * After the response, so nobody waits on it, but kept alive until it's done.
 * Best effort.
 */
function discard(signIn: SourceSignIn<Record<string, unknown>>, pending: string): void {
  if (signIn.discard) waitUntil(signIn.discard(pending).catch((error) => logError("signIn.discard", error)));
}

function failure(step: string, error: unknown): Result<never> {
  const known = fromCheckError(error);
  // Ours to fix (the service refused our key, or isn't reachable): the reason goes to the log.
  if (known?.status === "unavailable") logError(`signIn.${step}`, error);
  if (known) return fail(known.error);
  logError(`signIn.${step}`, error);
  return internalError();
}
