import { NextResponse, type NextRequest } from "next/server";

import { requireUser, UnauthorizedError } from "@/lib/auth/user";
import { finishMcpSignIn } from "@/lib/connections/mcp-sign-in";

/**
 * Where an MCP server's authorization server sends the browser after sign-in.
 * Finishes it for the signed-in user only (the state ties it to them) and goes
 * back to Data Connections with a result code. Never text from the server or
 * the query: only our own fixed codes reach the page.
 */
export async function GET(request: NextRequest) {
  const back = new URL("/connections", request.nextUrl.origin);
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) return new NextResponse("Unauthorized", { status: 401 });
    throw error;
  }

  const result = await finishMcpSignIn(userId, request.nextUrl.searchParams);
  // Back to the dashboard it was started from (an /apps path, checked when stored), or Data Connections.
  if (result.ok && result.data.returnTo) back.pathname = result.data.returnTo;
  if (result.ok) back.searchParams.set("signed_in", result.data.id);
  else back.searchParams.set("sign_in_error", /^[a-z_]{1,40}$/.test(result.error.code) ? result.error.code : "oauth_failed");
  return NextResponse.redirect(back, { status: 303 });
}
