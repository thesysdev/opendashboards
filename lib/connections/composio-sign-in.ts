import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { config as appConfig } from "@/config";
import { track } from "@/lib/analytics";
import { logError } from "@/lib/log";
import type { Scope } from "@/lib/orgs/access";
import { ComposioError, createSignInLink, deleteAccount, getAccount, type ComposioDeps, type ComposioToolkit } from "@/lib/sources/composio/client";
import { COMPOSIO_SIGN_IN, COMPOSIO_TOOLKITS, isComposioSignIn } from "@/lib/sources/composio/catalog";
import { readPendingSignIn, writeComposioCredential, writePendingSignIn, type PendingSignIn } from "@/lib/sources/composio/shared";
import { hashState } from "@/lib/sources/mcp/oauth";

import { getConnectionService } from ".";
import { fail, fromCheckError, fromValidation, internalError, notFound, ok, type Result } from "./errors";
import { connectionNameSchema, RETURN_PATH } from "./schemas";
import type { ConnectionService } from "./service";

/**
 * Signing in to Google Ads or Meta Ads through Composio: start (a Composio
 * account for this sign-in, and its hosted page, which runs the ad
 * platform's OAuth on Composio's approved app) and finish (the callback:
 * check it's this user's sign-in and wait for the account Composio made for
 * it to settle; saving it runs the source's own check that the account is
 * this sign-in's and active).
 *
 * The callback's own query parameters are never trusted for which account it
 * was: that's known, sealed, from the start.
 */


/**
 * Where Composio sends the browser back. The state is a path segment, not a
 * query parameter, so whatever Composio appends to the URL can't disturb it.
 */
export const composioCallbackUrl = (state: string) => `${appConfig().appOrigin}/api/composio/callback/${state}`;

/** A state this sign-in could have made: 32 random bytes, base64url. */
const STATE = /^[A-Za-z0-9_-]{43}$/;

const sharing = z.enum(["personal", "org"]).default("personal");

const startSchema = z.union([
  z.object({ name: connectionNameSchema, source: z.enum(COMPOSIO_TOOLKITS), sharing }).strict(),
  // Signing in again to a connection that exists.
  z.object({ connectionId: z.uuid(), returnTo: z.string().regex(RETURN_PATH).optional() }).strict(),
]);

type Deps = { service?: ConnectionService; composio?: ComposioDeps; pollMs?: number };

/** Starts a sign-in to a new Google Ads or Meta Ads connection, or again to one that exists. */
export async function startComposioSignIn(
  scope: Scope,
  input: unknown,
  deps: Deps = {},
): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const service = deps.service ?? getConnectionService();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);

  let toolkit: ComposioToolkit;
  let name: string;
  let connectionId: string | null = null;
  let existing: string | null = null;
  let returnTo: string | undefined;
  let sharingOf: "personal" | "org" = "personal";
  let orgId = scope.orgId;
  if ("connectionId" in parsed.data) {
    ({ returnTo } = parsed.data);
    const found = await service.forSignIn(scope.userId, parsed.data.connectionId);
    if (!found.ok) return found;
    if (!isComposioSignIn(found.data.config)) return notFound();
    toolkit = found.data.config.type;
    ({ name, orgId } = found.data);
    connectionId = found.data.id;
  } else {
    ({ name, source: toolkit, sharing: sharingOf } = parsed.data);
    // One connection per source that requires sign-in, like an MCP server: everyone signs in to the same one.
    const already = sharingOf === "personal" ? await service.signInConnectionTo(scope, { type: toolkit }) : null;
    if (already) {
      connectionId = already.id;
      ({ name } = already);
      existing = already.name;
    }
  }

  try {
    const state = randomBytes(32).toString("base64url");
    // A Composio user per sign-in: one person's accounts can never answer for another's.
    const composioUserId = `od-${randomUUID()}`;
    const link = await createSignInLink(toolkit, { composioUserId, callbackUrl: composioCallbackUrl(state) }, deps.composio);
    const pending = writePendingSignIn({ toolkit, composioUserId, connectedAccountId: link.connectedAccountId, returnTo });
    const saved = await service.startSignIn(
      { userId: scope.userId, orgId },
      { stateHash: hashState(state), connectionId, name, config: { type: toolkit, ...COMPOSIO_SIGN_IN }, pending, sharing: sharingOf },
    );
    if (!saved.ok) {
      discard(link.connectedAccountId, deps);
      return saved;
    }
    return ok({ authorizationUrl: link.redirectUrl, existing });
  } catch (error) {
    return failure("start", error);
  }
}

type StartedFrom = { orgId: string | null; returnTo: string | null };

/** Finishes a sign-in when Composio sends the browser back. `from` says where it started, once known. */
export async function finishComposioSignIn(
  userId: string,
  state: string | null,
  deps: Deps = {},
): Promise<Result<{ id: string; orgId: string | null; returnTo: string | null }> & { from: StartedFrom | null }> {
  const service = deps.service ?? getConnectionService();
  if (!state || !STATE.test(state)) return { ...fail({ code: "oauth_failed", message: "The sign-in came back without its state. Start again." }), from: null };

  // Taken once, for this user only, before it expires: a replayed or someone else's callback finds nothing.
  const taken = await service.takeSignIn(userId, hashState(state));
  if (!taken) {
    return { ...fail({ code: "oauth_expired", message: "This sign-in expired or was already used. Start it again from Data Connections." }), from: null };
  }
  const pending = readPendingSignIn(taken.pending);
  const back = pending.returnTo && RETURN_PATH.test(pending.returnTo) ? pending.returnTo : null;
  const from: StartedFrom = { orgId: taken.orgId, returnTo: back };
  const finished = (outcome: "done" | "denied" | "failed", errorCode: string | null = null) =>
    track(userId, "connection_sign_in_finished", { source_type: taken.config.type, outcome, error_code: errorCode, renewal: taken.connectionId !== null }, taken.orgId);

  if (taken.config.type !== pending.toolkit) {
    discard(pending.connectedAccountId, deps);
    return { ...internalError(), from };
  }
  try {
    const status = await settledStatus(pending, deps);
    if (status !== "ACTIVE") {
      finished(NOT_ACTIVE[status] ?? "failed", status in NOT_ACTIVE ? `account_${status.toLowerCase()}` : "account_other");
      discard(pending.connectedAccountId, deps);
      return { ...fail({ code: "oauth_failed", message: "The sign-in didn't complete. Try again." }), from };
    }
    const saved = await service.saveSignedIn(userId, {
      orgId: taken.orgId,
      connectionId: taken.connectionId,
      sharing: taken.sharing,
      name: taken.name,
      config: taken.config,
      credential: writeComposioCredential({ composioUserId: pending.composioUserId, connectedAccountId: pending.connectedAccountId }),
    });
    finished(saved.ok ? "done" : "failed", saved.ok ? null : saved.error.code);
    if (!saved.ok) {
      discard(pending.connectedAccountId, deps);
      return { ...saved, from };
    }
    return { ...ok({ id: saved.data.id, orgId: taken.orgId, returnTo: back }), from };
  } catch (error) {
    discard(pending.connectedAccountId, deps);
    const result = failure("finish", error);
    finished("failed", result.ok ? null : result.error.code);
    return { ...result, from };
  }
}

/**
 * An account that didn't come back active, for analytics: left or lapsed at
 * the ad platform reads as denied, a failure as failed. Any other status is
 * "account_other", and failed.
 */
const NOT_ACTIVE: Record<string, "denied" | "failed"> = { INITIATED: "denied", INACTIVE: "denied", EXPIRED: "denied", REVOKED: "denied", FAILED: "failed" };

/** Statuses Composio may still be moving on from when the browser arrives. */
const SETTLING = ["INITIATED", "INACTIVE"];

/**
 * The account's status once the sign-in has settled: a not-yet-active
 * account is asked again a few times. Whose account it is, and whether it's
 * usable, is the source's check when the sign-in is saved (checkAccount).
 */
async function settledStatus(pending: PendingSignIn, deps: Deps): Promise<string> {
  const attempts = 5;
  for (let attempt = 0; ; attempt++) {
    const { status } = await getAccount(pending.connectedAccountId, deps.composio, undefined, pending.toolkit);
    if (!SETTLING.includes(status) || attempt === attempts - 1) return status;
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 1_000));
  }
}

/**
 * Deletes the Composio account of a sign-in that didn't become a connection,
 * with whatever tokens it got. After the response, so the person isn't kept
 * waiting, but kept alive until it's done. Best effort.
 */
function discard(connectedAccountId: string, deps: Deps): void {
  waitUntil(deleteAccount(connectedAccountId, deps.composio).catch((error) => logError("composioSignIn.discard", error)));
}

function failure(step: string, error: unknown): Result<never> {
  const known = fromCheckError(error);
  // Ours to fix (Composio refused our key, or isn't reachable): the reason goes to the log.
  if (known?.status === "unavailable") logError(`composioSignIn.${step}`, error);
  if (known) return fail(known.error);
  if (error instanceof ComposioError) return fail({ code: "oauth_failed", message: "The sign-in didn't complete. Try again." });
  logError(`composioSignIn.${step}`, error);
  return internalError();
}
