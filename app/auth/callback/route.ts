import { NextResponse, type NextRequest } from "next/server";

import { safeNext, siteOrigin } from "@/lib/auth/site";
import { createClient } from "@/lib/supabase/server";

/** Google or GitHub sign-in lands here with a one-time code to swap for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const origin = siteOrigin(request.headers);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/auth/login?error=oauth&next=${encodeURIComponent(next)}`);
}
