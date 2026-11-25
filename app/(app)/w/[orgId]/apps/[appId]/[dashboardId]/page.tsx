import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { LiveDashboard } from "@/components/apps/live-dashboard";
import { getCurrentUserApp, trackDashboardView } from "@/lib/apps";
import { can } from "@/lib/orgs/policy";
import { appPath } from "@/lib/apps/paths";

type Params = Promise<{ orgId: string; appId: string; dashboardId: string }>;

// Moving here keeps the current page up until this one has its data, rather than showing it empty.
export const instant = false;

/** The tab shows the dashboard's title. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgId, appId, dashboardId } = await params;
  const app = await getCurrentUserApp(appId);
  const dashboard = app?.orgId === orgId ? app.dashboards.find((candidate) => candidate.id === dashboardId) : undefined;
  return dashboard ? { title: dashboard.title } : {};
}

/**
 * One dashboard of an app. Only dashboards of the user's own app resolve. A
 * dashboard that's gone (deleted, by the user or the agent, or a stale link)
 * leads to the app's home rather than a 404 that would hide the Build panel.
 */
export default async function DashboardPage({ params }: { params: Params }) {
  const { orgId, appId, dashboardId } = await params;
  const app = await getCurrentUserApp(appId);
  if (!app || app.orgId !== orgId) notFound();
  const dashboard = app.dashboards.find((candidate) => candidate.id === dashboardId);
  if (!dashboard) redirect(appPath(app.orgId, app.id));
  await trackDashboardView(app, dashboard);

  return <LiveDashboard key={dashboard.id} appId={app.id} dashboard={dashboard} readOnly={!can("dashboard", "update", app.facts)} />;
}
