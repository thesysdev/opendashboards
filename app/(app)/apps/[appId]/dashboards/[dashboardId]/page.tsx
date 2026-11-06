import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LiveDashboard } from "@/components/apps/live-dashboard";
import { getCurrentUserApp } from "@/lib/apps";

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

  return <LiveDashboard key={dashboard.id} artifactId={dashboard.artifactId} />;
}
