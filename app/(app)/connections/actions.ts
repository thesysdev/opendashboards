"use server";

import { refresh } from "next/cache";

import { track } from "@/lib/analytics";
import { getConnectionService } from "@/lib/connections";
import { startMcpSignIn } from "@/lib/connections/mcp-sign-in";
import { withLogContext } from "@/lib/log";
import { fail, type Result } from "@/lib/connections/errors";
import { inWorkspace, type Member, memberOf, requireKnownUser } from "@/lib/orgs";

/*
 * Each action is a public POST endpoint: it authenticates itself, and the
 * service validates the input and checks what the signed-in user may do in
 * the org they have open (or, for an existing connection, in its own org).
 * Inputs are typed `unknown` on purpose: nothing from the client is trusted.
 */

/** For a change to a connection that exists: it's in its own workspace, whichever page it's changed from. */
async function run<T>(
  call: (user: { userId: string }) => Promise<Result<T>>,
  { refreshOnFailure = false } = {},
): Promise<Result<T>> {
  const user = await requireKnownUser();
  const result = await withLogContext({ user: user.id }, () => call({ userId: user.id }));
  if (result.ok || refreshOnFailure) refresh();
  return result;
}

/** For something new: it goes in the workspace of the page it was sent from, never another tab's. */
async function runIn<T>(input: unknown, call: (member: Member, fields: unknown) => Promise<Result<T>>): Promise<Result<T>> {
  const { orgId, fields } = inWorkspace(input);
  const member = await memberOf(orgId);
  if (!member) return fail({ code: "not_found", message: "You aren't a member of this workspace any more. Reload the page." });
  const result = await withLogContext({ user: member.userId }, () => call(member, fields));
  if (result.ok) refresh();
  return result;
}

/**
 * Starts an OAuth sign-in to an MCP server (new, or again for an existing
 * connection). Returns the sign-in page to send the browser to; the
 * connection is saved when it comes back to /api/mcp/oauth/callback.
 */
export async function startMcpSignInAction(input: unknown) {
  const { orgId, fields } = inWorkspace(input);
  const member = await memberOf(orgId);
  if (!member) return fail({ code: "not_found", message: "You aren't a member of this workspace any more. Reload the page." });
  return startMcpSignIn(member, fields);
}

export async function createConnectionAction(input: unknown) {
  return runIn(input, async (member, fields) => {
    const result = await getConnectionService().create(member, fields);
    const type = (fields as { type?: unknown } | null)?.type;
    trackConnection(member.orgId, member.userId, typeof type === "string" ? type : "unknown", false, result);
    return result;
  });
}

/** Refreshes on failure too: the check records the new status either way. */
export async function retestConnectionAction(input: unknown) {
  return run(({ userId }) => getConnectionService().retest(userId, input), {
    refreshOnFailure: true,
  });
}

/** A new API key (PostHog) or password (Postgres) for a saved connection. */
export async function replaceCredentialAction(input: unknown) {
  return run(({ userId }) => getConnectionService().replaceCredential(userId, input));
}

export async function renameConnectionAction(input: unknown) {
  return run(({ userId }) => getConnectionService().rename(userId, input));
}

export async function deleteConnectionAction(input: unknown) {
  return run(({ userId }) => getConnectionService().remove(userId, input));
}

/** Deletes the caller's own sign-in to a connection. Anyone signed in may, a viewer included. */
export async function signOutOfConnectionAction(input: unknown) {
  return run(async ({ userId }) => {
    const result = await getConnectionService().signOut(userId, input);
    if (result.ok) track(userId, "connection_signed_out", {});
    return result;
  });
}

/** Installs a demo dataset: a connection of the org's that points at it. */
export async function installDemoAction(input: unknown) {
  return runIn(input, async (member, fields) => {
    const result = await getConnectionService().installDemo(member, fields);
    trackConnection(member.orgId, member.userId, "postgres", true, result);
    return result;
  });
}

/** Uninstalls a demo dataset, unless an app uses it. */
export async function uninstallDemoAction(input: unknown) {
  return runIn(input, (member, fields) => getConnectionService().uninstallDemo(member, fields));
}

function trackConnection(orgId: string, userId: string, sourceType: string, isDemo: boolean, result: Result<unknown>) {
  if (result.ok) track(userId, "connection_created", { source_type: sourceType, is_demo: isDemo }, orgId);
  // `field` is a form field's name ("host", "password"), never what was typed in it.
  else track(userId, "connection_failed", { source_type: sourceType, is_demo: isDemo, error_code: result.error.code, field: result.error.field ?? null }, orgId);
}
