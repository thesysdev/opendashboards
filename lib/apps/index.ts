import "server-only";

import { cache } from "react";

import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";

import { createAppService, type AppService } from "./service";
import { createThreadService, type ThreadService } from "./threads";
import { requireKnownUser } from "@/lib/orgs";

export type { AppDetail, AppGuest, AppSummary, AppTeammate, AppTreeNode, WorkspaceGuest } from "./service";
export type { AppThread } from "./threads";

let appService: AppService | undefined;
let threadService: ThreadService | undefined;

export function getAppService(): AppService {
  appService ??= createAppService({ db: getDb() });
  return appService;
}

export function getThreadService(): ThreadService {
  threadService ??= createThreadService({ db: getDb() });
  return threadService;
}

/**
 * The signed-in user's app, or null. Cached per request, so the app layout
 * and the dashboard page share one lookup.
 */
export const getCurrentUserApp = cache(async (appId: string) => {
  const user = await requireKnownUser();
  return getAppService().get(user.id, appId);
});

type ViewedApp = NonNullable<Awaited<ReturnType<typeof getCurrentUserApp>>>;

/**
 * Records that the signed-in user opened one of the app's dashboards, and how
 * they got in: owner, edit, view, or guest (let in by email). A guest's first
 * visit is the first of these with access "guest".
 */
export async function trackDashboardView(app: ViewedApp, dashboard: { artifactId: string }): Promise<void> {
  const user = await requireKnownUser();
  const { access, role, guest } = app.facts;
  track(
    user.id,
    "dashboard_viewed",
    { app_id: app.id, dashboard_id: dashboard.artifactId, access: guest ? "guest" : access, role, own_app: access === "owner" },
    app.orgId,
  );
}
