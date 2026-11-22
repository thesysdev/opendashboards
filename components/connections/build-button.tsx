"use client";

import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { createAppAction } from "@/app/(app)/apps/actions";
import { DISCOVERY_PROMPT } from "@/components/onboarding/discovery-prompt";
import { Button } from "@/components/ui/button";

/**
 * Starts a new app on one connection, with onboarding's "Explore my data"
 * prompt: it looks through the data and suggests dashboards to build.
 */
export function BuildButton({ connectionId, name }: { connectionId: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function build() {
    startTransition(async () => {
      // Only returns when creating failed; on success it opens the new app.
      const result = await createAppAction({ prompt: DISCOVERY_PROMPT, connectionIds: [connectionId] });
      if (result && !result.ok) toast.error(result.error.message);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={build} disabled={pending} aria-label={`Build a dashboard from ${name}`}>
      Build
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <ArrowRightIcon aria-hidden />}
    </Button>
  );
}
