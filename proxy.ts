import { NextResponse, type NextRequest } from "next/server";

import { getAuthProvider, type AuthProvider } from "@/lib/auth";
import { count } from "@/lib/metrics";

/** Served without a user: what crawlers and link previews fetch. */
const PUBLIC_FILES = ["/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon.svg", "/shiro-logo.svg"];

const isRead = (method: string) => method === "GET" || method === "HEAD";

/**
 * Rejects every request the auth provider doesn't recognize, before any page,
 * Route Handler or Server Action runs. `requireUser()` checks again close to
 * the data, as the Next.js docs recommend.
 *
 * Anyone may read the home page: signed out, it shows the composer and
 * nothing of a user's, and sign-in comes when they send a prompt. Only
 * reading it: a Server Action posted to it still needs a user.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const read = isRead(request.method);
  if (read && PUBLIC_FILES.includes(pathname)) return NextResponse.next();

  let provider: AuthProvider;
  try {
    provider = getAuthProvider();
  } catch {
    count("opendashboards.auth.rejected", { reason: "misconfigured" });
    return new NextResponse("Service unavailable", { status: 503 });
  }

  const result = await provider.authenticate(request.headers);
  if (!result.ok && !(read && pathname === "/")) {
    // Counted only here: requireUser() re-checks every request that passes.
    count("opendashboards.auth.rejected", { reason: result.reason });
    if (result.reason === "unavailable") return new NextResponse("Service unavailable", { status: 503 });
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static build output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
