import "server-only";

import { cache } from "react";

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
