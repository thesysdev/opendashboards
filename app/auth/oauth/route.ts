import { NextResponse, type NextRequest } from "next/server";

import { isSignInProvider, safeNext, siteOrigin } from "@/lib/auth/site";
import { createClient } from "@/lib/supabase/server";

/** Starts Google or GitHub sign-in. Supabase keeps the PKCE verifier in a cookie for the callback. */
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const origin = siteOrigin(request.headers);
  const failed = `${origin}/auth/login?error=oauth&next=${encodeURIComponent(next)}`;
  if (!isSignInProvider(provider)) return NextResponse.redirect(failed);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true },
  });
  return NextResponse.redirect(error || !data.url ? failed : data.url);
}
