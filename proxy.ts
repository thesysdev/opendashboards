import { NextResponse, type NextRequest } from "next/server";

import {
  AUTHORIZATION_HEADER,
  authenticate,
  getAuthConfig,
  USER_ID_HEADER,
  type AuthConfig,
} from "@/lib/auth/verify";
import { count } from "@/lib/metrics";
import { readSession } from "@/lib/supabase/session";

const unavailable = () => new NextResponse("Service unavailable", { status: 503 });

/** Pages go to a sign-in screen. API calls and Server Actions, which can't follow one, get a status. */
function refuse(request: NextRequest, status: 401 | 403) {
  const { pathname, search } = request.nextUrl;
  const isNavigation = (request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/");
  if (!isNavigation) return new NextResponse(status === 401 ? "Unauthorized" : "Forbidden", { status });
  const url = request.nextUrl.clone();
  url.pathname = "/auth/login";
  url.search = status === 403 ? "?error=denied" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

/**
 * Signs requests in before any page, Route Handler or Server Action runs, and
 * passes the identity on as a header. `requireUser()` checks that header again
 * close to the data, as the Next.js docs recommend.
 */
export async function proxy(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    count("prism.auth.rejected", { reason: "misconfigured" });
    return unavailable();
  }

  if (config.mode === "dev") {
    const result = await authenticate(request.headers, config);
    return result.ok ? NextResponse.next() : new NextResponse("Unauthorized", { status: 401 });
  }

  // Identity only ever comes from the session below, never from the browser.
  const headers = new Headers(request.headers);
  headers.delete(AUTHORIZATION_HEADER);
  headers.delete(USER_ID_HEADER);

  if (request.nextUrl.pathname.startsWith("/auth/")) return NextResponse.next({ request: { headers } });

  const session = await readSession(request);
  if (!session.accessToken) return session.apply(refuse(request, 401));

  headers.set(AUTHORIZATION_HEADER, `Bearer ${session.accessToken}`);
  const result = await authenticate(headers, config);
  if (result.ok) return session.apply(NextResponse.next({ request: { headers } }));

  // Counted only here: requireUser() re-checks every request that passes.
  count("prism.auth.rejected", { reason: result.reason });
  if (result.reason === "auth_unavailable") return unavailable();
  if (result.reason === "not_allowed") return session.apply(refuse(request, 403));
  return session.apply(refuse(request, 401));
}

export const config = {
  // Everything except Next's static build output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
