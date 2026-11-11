"use client";

import { useEffect } from "react";

import { analytics } from "@/lib/analytics";

/** Starts PostHog for the signed-in user. */
export function Analytics({ id, email }: { id: string; email: string }) {
  useEffect(() => analytics.identify({ id, email }), [id, email]);
  return null;
}
