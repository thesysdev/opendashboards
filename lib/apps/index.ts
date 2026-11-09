import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

import { config } from "@/config";

import { createChatLimits, type ChatLimits } from "./chat-limits";
import { createAppService, type AppService } from "./service";
import { createThreadService, type ThreadService } from "./threads";

export type { AppDetail, AppSummary, AppTreeNode } from "./service";
export type { AppThread } from "./threads";

let appService: AppService | undefined;
let threadService: ThreadService | undefined;
let chatLimits: ChatLimits | undefined;

export function getAppService(): AppService {
  appService ??= createAppService({ db: getDb() });
  return appService;
}

export function getChatLimits(): ChatLimits {
  const { limits } = config();
  chatLimits ??= createChatLimits({
    db: getDb(),
    limits: { perUserPerDay: limits.chatTurnsPerUserPerDay, perDay: limits.chatTurnsPerDay },
  });
  return chatLimits;
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
  const user = await requireUser();
  return getAppService().get(user.id, appId);
});
