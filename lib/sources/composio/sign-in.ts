import "server-only";

import { randomUUID } from "node:crypto";

import { SignInRefused } from "../sign-in";
import type { SourceSignIn } from "../types";

import { createSignInLink, getAccount, type ComposioDeps, type ComposioToolkit } from "./client";
import type { ComposioSignInConfig } from "./catalog";
import { readComposioCredential, releaseAccount, writeComposioCredential } from "./shared";

/**
 * Signing in to Google Ads or Meta Ads through Composio: its hosted page runs
 * the ad platform's OAuth on Composio's approved app, and Composio keeps the
 * tokens. What's kept, pending and once saved, is only which Composio account
 * it made: known from the start, so the callback's own query parameters are
 * never trusted for it. Whether that account is this sign-in's and usable is
 * the source's `test`, run when the sign-in is saved.
 */
export function composioSignIn(toolkit: ComposioToolkit, deps: () => ComposioDeps | undefined): SourceSignIn<ComposioSignInConfig> {
  return {
    async start({ callbackUrl }) {
      // A Composio user per sign-in: one person's accounts can never answer for another's.
      const composioUserId = `od-${randomUUID()}`;
      const link = await createSignInLink(toolkit, { composioUserId, callbackUrl }, deps());
      return { url: link.redirectUrl, pending: writeComposioCredential({ composioUserId, connectedAccountId: link.connectedAccountId }) };
    },

    async finish({ pending }) {
      const status = await settledStatus(toolkit, readComposioCredential(pending).connectedAccountId, deps());
      if (status !== "ACTIVE") throw new SignInRefused(NOT_ACTIVE[status] ?? "failed", status in NOT_ACTIVE ? `account_${status.toLowerCase()}` : "account_other");
      return pending;
    },

    discard: (pending) => releaseAccount(pending, deps()),
  };
}

/**
 * An account that didn't come back active: left or lapsed at the ad platform
 * reads as denied, a failure as failed. Any other status is "account_other", failed.
 */
const NOT_ACTIVE: Record<string, "denied" | "failed"> = { INITIATED: "denied", INACTIVE: "denied", EXPIRED: "denied", REVOKED: "denied", FAILED: "failed" };

/** Statuses Composio may still be moving on from when the browser arrives. */
const SETTLING = ["INITIATED", "INACTIVE"];

/** The account's status once the sign-in has settled: a not-yet-active account is asked again a few times. */
async function settledStatus(toolkit: ComposioToolkit, connectedAccountId: string, deps: ComposioDeps | undefined): Promise<string> {
  const attempts = 5;
  for (let attempt = 0; ; attempt++) {
    const { status } = await getAccount(connectedAccountId, deps, undefined, toolkit);
    if (!SETTLING.includes(status) || attempt === attempts - 1) return status;
    await new Promise((resolve) => setTimeout(resolve, deps?.pollMs ?? 1_000));
  }
}
