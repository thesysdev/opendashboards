import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DashboardPlaceholder } from "@/components/apps/dashboard-views";
import { MockDashboard } from "@/components/apps/mock-dashboard";
import { getCurrentUserApp } from "@/lib/apps";
import { MOCK_DASHBOARDS } from "@/lib/mock-dashboards";

type Params = Promise<{ appId: string; dashboardId: string }>;

/** One dashboard of an app. Only dashboards of the user's own app resolve. */
export default function DashboardPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Dashboard params={params} />
    </Suspense>
  );
}

async function Dashboard({ params }: { params: Params }) {
  const { appId, dashboardId } = await params;
  const app = await getCurrentUserApp(appId);
  const dashboard = app?.dashboards.find((candidate) => candidate.id === dashboardId);
  if (!dashboard) notFound();

  const mock = MOCK_DASHBOARDS[dashboard.title];
  if (mock) return <MockDashboard key={dashboard.id} source={mock} />;
  return <DashboardPlaceholder key={dashboard.id} title={dashboard.title} />;
}
