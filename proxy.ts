import { NextResponse, type NextRequest } from "next/server";

import { checkClaims, devUser, getAuthConfig, type AuthConfig } from "@/lib/auth/verify";
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

/** Signs requests in before any page, Route Handler or Server Action runs. `requireUser()` checks again close to the data. */
export async function proxy(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    count("prism.auth.rejected", { reason: "misconfigured" });
    return unavailable();
  }

  if (config.mode === "dev") {
    return devUser(request.headers, config.devUserId).ok ? NextResponse.next() : new NextResponse("Unauthorized", { status: 401 });
  }
  if (request.nextUrl.pathname.startsWith("/auth/")) return NextResponse.next();

  const session = await readSession(request);
  if (session.unavailable) {
    count("prism.auth.rejected", { reason: "auth_unavailable" });
    return unavailable();
  }

  const result = checkClaims(session.claims, config.allowlist);
  // `request` carries any refreshed cookies, so the app doesn't refresh the session again.
  if (result.ok) return session.apply(NextResponse.next({ request }));

  if (result.reason !== "signed_out") count("prism.auth.rejected", { reason: result.reason });
  return session.apply(refuse(request, result.reason === "not_allowed" ? 403 : 401));
}

export const config = {
  // Everything except Next's static build output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
