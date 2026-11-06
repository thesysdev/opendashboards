import type { HostKind } from "@/lib/db/schema";

/**
 * The only hosts Prism talks to for PostHog. A connection stores a host kind,
 * never a URL, so nothing a user types can point requests elsewhere.
 */
export const POSTHOG_HOSTS: Record<HostKind, { url: string; label: string }> = {
  posthog_us: { url: "https://us.posthog.com", label: "US Cloud" },
  posthog_eu: { url: "https://eu.posthog.com", label: "EU Cloud" },
};

export const HOST_KINDS = Object.keys(POSTHOG_HOSTS) as HostKind[];
