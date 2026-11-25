import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LINKS } from "@/components/landing/links";
import { config } from "@/config";
import { workspacePath } from "@/lib/apps/paths";
import { lastMember, NO_WORKSPACE_PATH } from "@/lib/orgs";

/**
 * Where the pricing page's "Get Standard" and "Get Team" lead, through
 * sign-in: the Billing section of the workspace the user was last in.
 */
export default function OpenBillingPage() {
  return (
    <Suspense fallback={null}>
      <OpenBilling />
    </Suspense>
  );
}

async function OpenBilling(): Promise<never> {
  // Billing off (not yet live, or self-hosted): paid plans are still arranged with sales.
  if (!config().plans) redirect(LINKS.sales);
  const member = await lastMember();
  redirect(member ? `${workspacePath(member.orgId, "settings")}#billing` : NO_WORKSPACE_PATH);
}
