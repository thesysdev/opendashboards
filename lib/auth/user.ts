import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { authenticate, getAuthConfig } from "./gateway";

export type CurrentUser = { id: string };

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * The signed-in user, from the gateway headers. Call it in every page, Server
 * Action and Route Handler that touches user data: `proxy.ts` already rejects
 * unauthenticated requests, and this re-checks close to the data.
 *
 * It reads request headers, so with Cache Components it must run inside a
 * `<Suspense>` boundary when called from a page or layout.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const result = authenticate(await headers(), getAuthConfig());
  if (!result.ok) throw new UnauthorizedError();
  return { id: result.userId };
});
