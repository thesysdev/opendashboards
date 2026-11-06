"use server";

import { refresh } from "next/cache";

import { requireUser } from "@/lib/auth/user";
import { getConnectionService } from "@/lib/connections";
import type { Result } from "@/lib/connections/errors";

/*
 * Each action is a public POST endpoint: it authenticates itself, and the
 * service validates the input and scopes everything to the signed-in user.
 * Inputs are typed `unknown` on purpose: nothing from the client is trusted.
 */

async function run<T>(
  call: (userId: string) => Promise<Result<T>>,
  { refreshOnFailure = false } = {},
): Promise<Result<T>> {
  const user = await requireUser();
  const result = await call(user.id);
  if (result.ok || refreshOnFailure) refresh();
  return result;
}

export async function createConnectionAction(input: unknown) {
  return run((userId) => getConnectionService().create(userId, input));
}

/** Refreshes on failure too: the check records the new status either way. */
export async function retestConnectionAction(input: unknown) {
  return run((userId) => getConnectionService().retest(userId, input), {
    refreshOnFailure: true,
  });
}

/** A new API key (PostHog) or password (Postgres) for a saved connection. */
export async function replaceCredentialAction(input: unknown) {
  return run((userId) => getConnectionService().replaceCredential(userId, input));
}

export async function renameConnectionAction(input: unknown) {
  return run((userId) => getConnectionService().rename(userId, input));
}

export async function deleteConnectionAction(input: unknown) {
  return run((userId) => getConnectionService().remove(userId, input));
}
