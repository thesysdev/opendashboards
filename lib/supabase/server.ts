import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { secrets } from "@/config";

/** Supabase client for the sign-in routes, using the request's session cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(secrets.supabaseUrl()!, secrets.supabasePublishableKey()!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      },
    },
  });
}
