import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { secrets } from "@/config";

/** Supabase client for server code, using the request's session cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(secrets.supabaseUrl()!, secrets.supabasePublishableKey()!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't write cookies; `proxy.ts` has already refreshed the session.
        }
      },
    },
  });
}
