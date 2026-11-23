import { redirect } from "next/navigation";
import { Suspense } from "react";

import { workspacePath } from "@/lib/apps/paths";
import { lastMember, NO_WORKSPACE_PATH } from "@/lib/orgs";

/**
 * The way in, from the landing page and after signing in: the workspace the
 * user was last in, or the one they've been in longest.
 */
export default function OpenWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <OpenWorkspace />
    </Suspense>
  );
}

async function OpenWorkspace(): Promise<never> {
  const member = await lastMember();
  redirect(member ? workspacePath(member.orgId) : NO_WORKSPACE_PATH);
}
