import { notFound } from "next/navigation";

import { NoDashboards } from "@/components/apps/dashboard-views";
import { LiveDashboard } from "@/components/apps/live-dashboard";
import { getCurrentUserApp, trackDashboardView } from "@/lib/apps";
import { can } from "@/lib/orgs/policy";

// Moving here keeps the current page up until this one has its data, rather than showing it empty.
export const instant = false;

/** An app's home: its first dashboard, or the empty state when it has none. */
export default async function AppHomePage({ params }: { params: Promise<{ orgId: string; appId: string }> }) {
  const { orgId, appId } = await params;
  const app = await getCurrentUserApp(appId);
  if (!app || app.orgId !== orgId) notFound();

  const first = app.dashboards[0];
  if (first) await trackDashboardView(app, first);
  return first ? (
    <LiveDashboard key={first.id} appId={app.id} dashboard={first} readOnly={!can("dashboard", "update", app.facts)} />
  ) : (
    <NoDashboards hasPendingPrompt={Boolean(app.pendingPrompt)} readOnly={!can("dashboard", "update", app.facts)} />
  );
}
