import { NextResponse, type NextRequest } from "next/server";

import { workspacePath } from "@/lib/apps/paths";
import { requireUser, UnauthorizedError } from "@/lib/auth/user";
import { finishMcpSignIn } from "@/lib/connections/mcp-sign-in";
import { lastMember } from "@/lib/orgs";

/**
 * Where an MCP server's authorization server sends the browser after sign-in.
 * Finishes it for the signed-in user only (the state ties it to them) and goes
 * back with a result code: to the dashboard it was started from, or Data
 * Connections in the connection's workspace. Never text from the server or
 * the query: only our own fixed codes reach the page.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) return new NextResponse("Unauthorized", { status: 401 });
    throw error;
  }

  const result = await finishMcpSignIn(userId, request.nextUrl.searchParams);
  // A sign-in that failed may not say which workspace it was for: the one they were last in.
  const orgId = (result.ok && result.data.orgId) || (await lastMember())?.orgId;
  // A dashboard path was checked when it was stored.
  const path = result.ok && result.data.returnTo ? result.data.returnTo : orgId ? workspacePath(orgId, "connections") : "/apps";
  const back = new URL(path, request.nextUrl.origin);
  if (result.ok) back.searchParams.set("signed_in", result.data.id);
  else back.searchParams.set("sign_in_error", /^[a-z_]{1,40}$/.test(result.error.code) ? result.error.code : "oauth_failed");
  return NextResponse.redirect(back, { status: 303 });
}
