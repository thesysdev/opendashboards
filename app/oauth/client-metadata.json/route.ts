import { NextResponse } from "next/server";

import { mcpClientMetadataUrl, mcpSignInRedirectUri } from "@/lib/connections/mcp-sign-in";
import { clientMetadataDocument } from "@/lib/sources/mcp/oauth";

/**
 * OpenDashboards' client metadata document (CIMD). An MCP server's
 * authorization server fetches it, without signing in, to learn who's asking
 * and where sign-ins may return. Nothing in it belongs to a user. Not found
 * where it's switched off (`mcpClientMetadataDocument`).
 */
export function GET() {
  const clientId = mcpClientMetadataUrl();
  if (!clientId) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(clientMetadataDocument(clientId, mcpSignInRedirectUri()), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
