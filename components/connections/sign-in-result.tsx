"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Our own messages for the callback's result codes. Nothing from the URL is shown as is. */
const MESSAGES: Record<string, string> = {
  oauth_expired: "That sign-in expired or was already used. Start it again.",
  oauth_failed: "The sign-in didn't complete. Try again.",
  // Someone else took the last connection while this person was signing in.
  plan_limit: "Your workspace has no connections left on its plan.",
  oauth_invalid: "The server's sign-in failed a safety check, so OpenDashboards didn't connect to it.",
  oauth_unsupported: "This server's OAuth sign-in isn't supported.",
  reauth_required: "The sign-in was refused. Try signing in again.",
  credential_too_large: "The server's sign-in tokens are too large to store securely.",
  host_blocked: "The server's sign-in points to an address OpenDashboards won't connect to.",
  not_found: "That connection no longer exists.",
  // Sources that sign in to the platform itself (Google Ads, Meta Ads).
  not_configured: "This source isn't set up on OpenDashboards yet.",
  provider_rejected: "OpenDashboards couldn't finish the sign-in on its side. Try again later.",
  ads_unavailable: "Couldn't reach the platform to finish the sign-in. Try again.",
  ads_unexpected: "The platform sent an unexpected response. Try again.",
  timeout: "The sign-in took too long to finish. Try again.",
  rate_limited: "Too many requests right now. Try again in a minute.",
};

/** After an OAuth sign-in comes back: says how it went, once, then tidies the URL. */
export function SignInResult() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = params.get("signed_in");
  const error = params.get("sign_in_error");

  useEffect(() => {
    if (!signedIn && !error) return;
    if (signedIn) toast.success("Signed in and connected");
    else toast.error(MESSAGES[error ?? ""] ?? "The sign-in didn't complete. Try again.");
    router.replace(pathname);
  }, [signedIn, error, router, pathname]);

  return null;
}
