"use client";

import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { createAppAction } from "@/app/(app)/apps/actions";
import { useAtLimit, useViewOnly } from "@/components/billing/workspace-plan";
import { DISCOVERY_PROMPT } from "@/components/onboarding/discovery-prompt";
import { Button } from "@/components/ui/button";
import { useWorkspaceId } from "@/lib/apps/use-workspace";

/**
 * Starts a new app on one connection, with onboarding's "Explore my data"
 * prompt: it looks through the data and suggests dashboards to build.
 */
export function BuildButton({ connectionId, name }: { connectionId: string; name: string }) {
  const orgId = useWorkspaceId();
  const [pending, startTransition] = useTransition();
  // A new app: paused while the workspace is over its plan or at its app limit (the home page says why).
  const viewOnly = useViewOnly();
  const atLimit = useAtLimit("apps");

  function build() {
    startTransition(async () => {
      // Only returns when creating failed; on success it opens the new app.
      // In the workspace of the page it's started from, which the connection is in.
      const result = await createAppAction({ orgId, prompt: DISCOVERY_PROMPT, connectionIds: [connectionId] });
      if (result && !result.ok) toast.error(result.error.message);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={build} disabled={pending || viewOnly || atLimit} aria-label={`Build a dashboard from ${name}`}>
      Build
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <ArrowRightIcon aria-hidden />}
    </Button>
  );
}
