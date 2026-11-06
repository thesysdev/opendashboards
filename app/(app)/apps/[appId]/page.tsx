import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DashboardPlaceholder, NoDashboards } from "@/components/apps/dashboard-views";
import { MockDashboard } from "@/components/apps/mock-dashboard";
import { getCurrentUserApp } from "@/lib/apps";
import { MOCK_DASHBOARDS } from "@/lib/mock-dashboards";

/** An app's home: its first dashboard, or the empty state when it has none. */
export default function AppHomePage({ params }: { params: Promise<{ appId: string }> }) {
  return (
    <Suspense fallback={null}>
      <AppHome params={params} />
    </Suspense>
  );
}

async function AppHome({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const app = await getCurrentUserApp(appId);
  if (!app) notFound();

  const first = app.dashboards[0];
  if (first && MOCK_DASHBOARDS[first.title]) return <MockDashboard source={MOCK_DASHBOARDS[first.title]} />;
  return first ? (
    <DashboardPlaceholder title={first.title} />
  ) : (
    <NoDashboards hasPendingPrompt={Boolean(app.pendingPrompt)} />
  );
}
