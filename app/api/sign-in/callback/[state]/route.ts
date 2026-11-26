import type { NextRequest } from "next/server";

import { finishSignIn } from "@/lib/connections/sign-in";
import { signInCallback } from "@/lib/connections/sign-in-callback";

/** Where a source's sign-in page sends the browser back (Google Ads and Meta Ads, through Composio). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  return signInCallback((userId) => finishSignIn(userId, state, request.nextUrl.searchParams));
}
