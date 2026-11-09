import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { secrets } from "@/config";

type PendingCookie = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Reads the Supabase session in `proxy.ts`, refreshing it if it has expired.
 * The token isn't trusted here: `lib/auth/verify.ts` checks it. Refreshed
 * cookies reach the browser through whatever response `apply` is given.
 */
export async function readSession(request: NextRequest) {
  const pending: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(secrets.supabaseUrl()!, secrets.supabasePublishableKey()!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pending.push({ name, value, options });
        }
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  const { data } = await supabase.auth.getSession();

  function apply<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pending) response.cookies.set(name, value, options);
    for (const [key, value] of Object.entries(pendingHeaders)) response.headers.set(key, value);
    return response;
  }

  return { accessToken: data.session?.access_token ?? null, apply };
}
