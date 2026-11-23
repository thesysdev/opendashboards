"use client";

import { useEffect } from "react";

import { rememberWorkspaceAction } from "@/app/(app)/settings/actions";

/** Notes the workspace on screen as the one /apps opens next time. */
export function RememberWorkspace({ orgId }: { orgId: string }) {
  useEffect(() => {
    void rememberWorkspaceAction(orgId);
  }, [orgId]);
  return null;
}
