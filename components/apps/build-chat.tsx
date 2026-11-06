"use client";

import {
  AgentInterface,
  fetchLLM,
  openAIAdapter,
  openAIMessageFormat,
  useOpenuiCloudStorage,
  useThread,
} from "@openuidev/react-ui";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import "@openuidev/react-ui/styles/index.css";

import { takePendingPromptAction } from "@/app/(app)/apps/actions";
import { dashboardPath, parseAppPath } from "@/lib/apps/paths";
import { scopeStorageToApp } from "@/lib/apps/thread-storage";

type Dashboard = { id: string };

/**
 * The Build panel: Agent Interface over the app's own chat threads in OpenUI
 * Cloud. Replies are Markdown; dashboards the agent builds open in the main
 * pane when its turn ends.
 */
export function BuildChat({
  appId,
  dashboards,
  hasPendingPrompt,
}: {
  appId: string;
  dashboards: Dashboard[];
  hasPendingPrompt: boolean;
}) {
  const cloud = useOpenuiCloudStorage({ token: "/api/frontend-token" });
  const storage = useMemo(() => scopeStorageToApp(cloud, appId), [cloud, appId]);
  const llm = useMemo(
    () =>
      fetchLLM({
        url: `/api/apps/${encodeURIComponent(appId)}/chat`,
        streamAdapter: openAIAdapter(),
        messageFormat: openAIMessageFormat,
      }),
    [appId],
  );

  return (
    <div className="prism-build-chat flex min-h-0 flex-1 flex-col">
      <AgentInterface llm={llm} storage={storage} agentName="Prism" scrollVariant="always">
        <AgentInterface.Welcome
          title={dashboards.length ? "Change or add dashboards" : "Ask for a dashboard"}
          description="Describe what you want to see. Prism explores your data and builds it."
        />
        <TurnEffects appId={appId} dashboards={dashboards} hasPendingPrompt={hasPendingPrompt} />
      </AgentInterface>
    </div>
  );
}

/**
 * Inside the chat: sends the app's first prompt once, and when a turn ends
 * refreshes the app and opens the dashboard the turn created.
 */
function TurnEffects({
  appId,
  dashboards,
  hasPendingPrompt,
}: {
  appId: string;
  dashboards: Dashboard[];
  hasPendingPrompt: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const processMessage = useThread((state) => state.processMessage);
  const isRunning = useThread((state) => state.isRunning);

  // The prompt the app was created with goes first, once.
  const sentPending = useRef(false);
  useEffect(() => {
    if (!hasPendingPrompt || sentPending.current) return;
    sentPending.current = true;
    void takePendingPromptAction(appId).then((prompt) => {
      if (prompt) void processMessage({ role: "user", content: prompt });
      router.refresh();
    });
  }, [appId, hasPendingPrompt, processMessage, router]);

  // When a turn ends, pick up what it built.
  const known = useRef(new Set(dashboards.map((dashboard) => dashboard.id)));
  const wasRunning = useRef(false);
  const awaitingNew = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      awaitingNew.current = true;
      router.refresh();
    }
    wasRunning.current = isRunning;
  }, [isRunning, router]);

  useEffect(() => {
    const added = dashboards.filter((dashboard) => !known.current.has(dashboard.id));
    known.current = new Set(dashboards.map((dashboard) => dashboard.id));
    if (!awaitingNew.current || !added.length) return;
    awaitingNew.current = false;
    const newest = added[added.length - 1];
    if (parseAppPath(pathname).dashboardId !== newest.id) router.push(dashboardPath(appId, newest.id));
  }, [appId, dashboards, pathname, router]);

  return null;
}
