import { createHash, randomBytes } from "node:crypto";

/**
 * What every sign-in shares, whichever source runs it: the state that ties
 * the callback to the sign-in it started, and how a sign-in that didn't
 * complete says so.
 */

/** A new sign-in's state: 32 random bytes, base64url. Sent out; only its hash is kept. */
export const newState = () => randomBytes(32).toString("base64url");

/** What's kept of a state: SHA-256, hex. */
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

/**
 * Thrown by a source's `signIn.finish` when the sign-in didn't complete:
 * `denied` when the person said no or let it lapse, `failed` otherwise.
 * `code` is for analytics, never shown.
 */
export class SignInRefused extends Error {
  constructor(
    readonly outcome: "denied" | "failed",
    readonly code: string,
  ) {
    super(`Sign-in ${outcome}: ${code}`);
    this.name = "SignInRefused";
  }
}

/** Whether a callback's state is one a sign-in here could have made. */
export const isState = (state: string) => /^[A-Za-z0-9_-]{43}$/.test(state);
