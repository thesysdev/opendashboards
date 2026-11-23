import { notFound } from "next/navigation";
import { Suspense } from "react";

import { NoDashboards } from "@/components/apps/dashboard-views";
import { LiveDashboard } from "@/components/apps/live-dashboard";
import { getCurrentUserApp } from "@/lib/apps";

/** An app's home: its first dashboard, or the empty state when it has none. */
export default function AppHomePage({ params }: { params: Promise<{ orgId: string; appId: string }> }) {
  return (
    <Suspense fallback={null}>
      <AppHome params={params} />
    </Suspense>
  );
}

async function AppHome({ params }: { params: Promise<{ orgId: string; appId: string }> }) {
  const { orgId, appId } = await params;
  const app = await getCurrentUserApp(appId);
  if (!app || app.orgId !== orgId) notFound();

  const first = app.dashboards[0];
  return first ? (
    <LiveDashboard key={first.id} appId={app.id} dashboard={first} readOnly={!app.canChange} />
  ) : (
    <NoDashboards hasPendingPrompt={Boolean(app.pendingPrompt)} readOnly={!app.canChange} />
  );
}
