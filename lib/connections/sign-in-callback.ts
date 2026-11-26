import "server-only";

import { NextResponse } from "next/server";

import { config } from "@/config";
import { workspacePath } from "@/lib/apps/paths";
import { UnauthorizedError } from "@/lib/auth/user";
import { lastMember, requireKnownUser } from "@/lib/orgs";

import type { Result } from "./errors";
import type { StartedFrom } from "./sign-in";

/**
 * A sign-in's callback route: finishes it for the signed-in user only (its
 * state ties it to them) and goes back with a result code, to the dashboard
 * it was started from, or Data Connections in its workspace. Never text from
 * the sign-in page or the query: only our own fixed codes reach the page.
 */
export async function signInCallback(finish: (userId: string) => Promise<Result<{ id: string }> & { from: StartedFrom | null }>): Promise<NextResponse> {
  let userId: string;
  try {
    userId = (await requireKnownUser()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) return new NextResponse("Unauthorized", { status: 401 });
    throw error;
  }

  const result = await finish(userId);
  // Back where it started, however it ended. Only a callback that matches no sign-in of theirs
  // doesn't say which workspace it was for: then the one they were last in.
  const orgId = result.from ? result.from.orgId : (await lastMember())?.orgId;
  // A dashboard path was checked when it was stored.
  const path = result.from?.returnTo ?? (orgId ? workspacePath(orgId, "connections") : "/apps");
  // The public app origin: behind the gateway, the request's own origin may be an internal one.
  const back = new URL(path, config().appOrigin);
  if (result.ok) back.searchParams.set("signed_in", result.data.id);
  else back.searchParams.set("sign_in_error", /^[a-z_]{1,40}$/.test(result.error.code) ? result.error.code : "oauth_failed");
  return NextResponse.redirect(back, { status: 303 });
}
