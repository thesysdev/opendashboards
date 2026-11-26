import type { NextRequest } from "next/server";

import { finishMcpSignIn } from "@/lib/connections/mcp-sign-in";
import { signInCallback } from "@/lib/connections/sign-in-callback";

/** Where an MCP server's authorization server sends the browser after sign-in. Exactly the URL registered with it. */
export async function GET(request: NextRequest) {
  return signInCallback((userId) => finishMcpSignIn(userId, request.nextUrl.searchParams));
}
