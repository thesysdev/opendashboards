import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { getAuthProvider, type AuthUser } from ".";

export type CurrentUser = AuthUser;

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** One check per request, shared by everything that asks who it's for. */
const authenticate = cache(async () => {
  // Checking a token's expiry reads the clock, which only happens at request time.
  await connection();
  return getAuthProvider().authenticate(await headers());
});

/**
 * The signed-in user, as the configured auth provider sees it. Call it in every page, Server
 * Action and Route Handler that touches user data: `proxy.ts` already rejects
 * unauthenticated requests, and this re-checks close to the data.
 *
 * It reads request headers, so with Cache Components it must run inside a
 * `<Suspense>` boundary when called from a page or layout.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * The signed-in user, or null. Only for what a signed-out visitor may see:
 * the home page and the shell around it, which `proxy.ts` lets anyone read.
 * Anything that touches user data calls `requireUser()` instead.
 */
export async function getUser(): Promise<CurrentUser | null> {
  const result = await authenticate();
  return result.ok ? result.user : null;
}
