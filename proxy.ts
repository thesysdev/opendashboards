import { NextResponse, type NextRequest } from "next/server";

import { authenticate, getAuthConfig, type AuthConfig } from "@/lib/auth/gateway";

/**
 * Rejects every request that didn't come through the gateway, before any page,
 * Route Handler or Server Action runs. `requireUser()` checks again close to
 * the data, as the Next.js docs recommend.
 */
export function proxy(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return new NextResponse("Service unavailable", { status: 503 });
  }

  const result = authenticate(request.headers, config);
  if (!result.ok) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static build output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
