import { NextResponse, type NextRequest } from "next/server";

import { siteOrigin } from "@/lib/auth/site";
import { createClient } from "@/lib/supabase/server";

/** POST only, so a link or prefetch can't sign someone out. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${siteOrigin(request.headers)}/auth/login`, { status: 303 });
}
