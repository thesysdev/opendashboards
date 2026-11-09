import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { secrets } from "@/config";

type PendingCookie = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Verifies the Supabase session in `proxy.ts`, refreshing it first if it has
 * expired. Refreshed cookies are copied onto the request, so the app sees them
 * through `NextResponse.next({ request })`, and reach the browser through `apply`.
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

  // A malformed token makes getClaims throw rather than return an error: treat it as signed out.
  const { data, error } = await supabase.auth.getClaims().catch(() => ({ data: null, error: null }));

  function apply<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pending) response.cookies.set(name, value, options);
    for (const [key, value] of Object.entries(pendingHeaders)) response.headers.set(key, value);
    return response;
  }

  return { claims: data?.claims ?? null, unavailable: isAuthRetryableFetchError(error), apply };
}
