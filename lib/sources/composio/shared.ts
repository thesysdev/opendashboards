import "server-only";

import { z } from "zod";

import type { ConnectionSource, OpenConnection, QueryResult, SourceError } from "../types";

import { ComposioError, deleteAccount, getAccount, isRecord, runTool, type ComposioAccountRef, type ComposioDeps, type ComposioToolkit } from "./client";
import { COMPOSIO_TOOLKITS, type ComposioSignInConfig } from "./catalog";

/**
 * What the sources that sign in through Composio share: the stored
 * credential (which Composio account is this connection's), how failures
 * read, and keeping a lost sign-in visible.
 */

/**
 * The stored credential: the Composio user and connected account this
 * connection runs as. Not a token (Composio holds those), but sealed like
 * one: with our project key, it's what reads this person's ad data.
 */
const storedSchema = z.object({ composioUserId: z.string().min(1), connectedAccountId: z.string().min(1) }).strict();

export function readComposioCredential(credential: string): ComposioAccountRef {
  return storedSchema.parse(JSON.parse(credential));
}

export function writeComposioCredential(account: ComposioAccountRef): string {
  return JSON.stringify(storedSchema.parse(account));
}

/**
 * What a sign-in started and not yet finished keeps (sealed) until the
 * browser comes back: the Composio account it made, whose user that is, and
 * where to go back to.
 */
const pendingSchema = z
  .object({ toolkit: z.enum(COMPOSIO_TOOLKITS), composioUserId: z.string().min(1), connectedAccountId: z.string().min(1), returnTo: z.string().optional() })
  .strict();

export type PendingSignIn = z.infer<typeof pendingSchema>;

export function readPendingSignIn(pending: string): PendingSignIn {
  return pendingSchema.parse(JSON.parse(pending));
}

export function writePendingSignIn(pending: PendingSignIn): string {
  return JSON.stringify(pendingSchema.parse(pending));
}

/**
 * The credential part of a Composio source. There's nothing to paste: these
 * connect only by signing in, so the form's credential check always refuses.
 */
export function composioCredential(label: string, purpose: string): ConnectionSource<ComposioSignInConfig>["credential"] {
  return {
    field: "signIn",
    schema: z.string().refine(() => false, `${label} connects by signing in, not with a key.`),
    purpose,
    hint: (credential) => {
      const { connectedAccountId } = readComposioCredential(credential);
      return `Composio ${connectedAccountId.slice(0, 5)}…${connectedAccountId.slice(-4)}`;
    },
  };
}

/** Deletes the connection's Composio account, with its ad platform tokens: the source's `release`. */
export async function releaseAccount(credential: string, deps?: ComposioDeps): Promise<void> {
  await deleteAccount(readComposioCredential(credential).connectedAccountId, deps);
}


/** Throws unless the account is this toolkit's, this Composio user's, and active now. */
export async function checkAccount(toolkit: ComposioToolkit, account: ComposioAccountRef, deps?: ComposioDeps, signal?: AbortSignal): Promise<void> {
  const found = await getAccount(account.connectedAccountId, deps, signal, toolkit);
  // Fails closed: an account Composio doesn't say is this user's and this toolkit's isn't.
  if (found.userId !== account.composioUserId) throw new ComposioError("reauth_required", "The account isn't this sign-in's", toolkit);
  if (found.toolkit !== toolkit) throw new ComposioError("reauth_required", `The account is for ${found.toolkit ?? "an unknown toolkit"}`, toolkit);
  if (found.disabled || found.status !== "ACTIVE") throw new ComposioError("reauth_required", `The account is ${found.disabled ? "disabled" : found.status.toLowerCase()}`, toolkit);
}

/**
 * Runs one of the source's tools as the connection's account. A sign-in that
 * Composio says is gone marks the connection for signing in again, so the
 * banner shows and nobody waits on a query that can't work.
 */
export async function runAs(
  toolkit: ComposioToolkit,
  connection: OpenConnection<ComposioSignInConfig>,
  slug: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const account = readComposioCredential(connection.credential);
  try {
    return await runTool(toolkit, slug, account, args, signal);
  } catch (error) {
    if (error instanceof ComposioError && error.code === "reauth_required" && connection.updateCredential) {
      await connection.updateCredential(async (current) => ({ credential: current, status: "invalid" }));
    }
    throw error;
  }
}

/**
 * The user-facing error for a Composio failure of one source (its type and
 * catalog label). Only its own: an error that doesn't say which source it's
 * from isn't claimed.
 */
export function composioToError(
  { type, label }: { type: ComposioToolkit; label: string },
  error: unknown,
): { error: SourceError; status: "invalid" | "unavailable" } | null {
  if (!(error instanceof ComposioError) || error.toolkit !== type) return null;
  const unavailable = (code: string, message: string) => ({ status: "unavailable" as const, error: { code, message } });
  switch (error.code) {
    case "not_configured":
      return unavailable("not_configured", `${label} isn't set up on this OpenDashboards yet. Ask the team that runs it.`);
    case "project_rejected":
      return unavailable("provider_rejected", `OpenDashboards couldn't reach ${label} on its side. Try again later.`);
    case "reauth_required":
      return {
        status: "invalid",
        error: { code: "reauth_required", message: `The sign-in to ${label} expired or was revoked. Sign in again from Data Connections.` },
      };
    case "bad_request":
      return unavailable("bad_query", `${label} rejected the request: ${(error.detail ?? "invalid request").slice(0, 500)}`);
    case "rate_limited":
      return unavailable("rate_limited", `${label} is limiting requests right now. Use a shorter date range or fewer breakdowns, and try again in a minute.`);
    case "timeout":
      return unavailable("timeout", `${label} took too long to answer. Try a shorter date range or fewer breakdowns.`);
    case "unavailable":
      return unavailable("ads_unavailable", `Couldn't reach ${label}. Try again.`);
    case "unexpected":
      return unavailable("ads_unexpected", `${label} sent an unexpected response. Try again.`);
  }
}

/**
 * Nested API rows as flat columns: { campaign: { name } } becomes
 * "campaign.name". Arrays of { action_type, value } (Meta's actions) become
 * one column per type. Numeric strings in metric columns become numbers.
 */
export function flattenRows(rows: unknown[], isMetric: (column: string) => boolean, maxRows: number): QueryResult {
  const flat = rows.slice(0, maxRows).map((row) => {
    const out: Record<string, unknown> = {};
    flatten(row, "", out);
    for (const [column, value] of Object.entries(out)) {
      if (typeof value === "string" && isMetric(column) && /^-?\d+(\.\d+)?$/.test(value)) out[column] = Number(value);
    }
    return out;
  });
  const columns = [...new Set(flat.flatMap((row) => Object.keys(row)))];
  return { columns, rows: flat, truncated: rows.length > maxRows };
}

function flatten(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (Array.isArray(value)) {
    if (value.every((item) => isRecord(item) && typeof item.action_type === "string" && "value" in item)) {
      for (const item of value as { action_type: string; value: unknown }[]) out[`${prefix}.${item.action_type}`] = item.value;
      return;
    }
    out[prefix] = JSON.stringify(value);
    return;
  }
  if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  out[prefix || "value"] = value ?? null;
}
