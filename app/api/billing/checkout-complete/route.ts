import { redirect } from "next/navigation";

import { workspacePath } from "@/lib/apps/paths";
import { route } from "@/lib/http";
import { getPlans } from "@/lib/plans";

/**
 * Where Stripe Checkout sends the browser once it's paid. Saves the
 * subscription now rather than waiting for the webhook, so the new plan's
 * limits apply on the very next page, then opens the workspace's Billing
 * section (a new workspace, if that's what was bought).
 */
export const GET = route(async (request, user) => {
  const plans = getPlans();
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!plans || !sessionId || !sessionId.startsWith("cs_")) redirect("/apps");
  const orgId = await plans.billing.completeCheckout(sessionId, user.id);
  redirect(orgId ? `${workspacePath(orgId, "settings")}#billing` : "/apps");
});
