"use client";

import { useArtifactStream, type ToolActivity } from "@openuidev/react-headless";
import { ArrowRightIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { toolLogo } from "@/components/connections/tool-logo";
import { dashboardPath } from "@/lib/apps/paths";
import { useWorkspaceId } from "@/lib/apps/use-workspace";
import { reportCall, reportStream, useBuild } from "@/lib/dashboards/build-tracker";
import { referenceOf } from "@/lib/dashboards/reference";
import { cn } from "@/lib/utils";

import { useDashboardsOnScreen } from "./app-workspace";
import { BuildCardHeader, BuildFeedCard, Glyph, buildActive, type SettledStatus } from "./build-feed";

/** The tools whose calls make or change a dashboard: each gets a card, not a timeline row. */
export const isDashboardBuildTool = (name: string) => name === "create_dashboard" || name === "edit_dashboard";

/** What a stopped call is answered with (lib/agent/messages.ts), so a reloaded chat can say "Stopped". */
const STOPPED = /^Stopped by the user/;

/** How a finished call's result reads when it isn't a dashboard: the agent tools' `{ error }`, or Cloud's own sentence. */
function failureOf(result: string): string {
  try {
    const message = (JSON.parse(result) as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {}
  return result.split("\n")[0] || "The dashboard couldn't be built.";
}

/**
 * The card in the Build chat for a create_dashboard or edit_dashboard call.
 *
 * It follows the build on its own, so the chat tells the whole story with the dashboard
 * somewhere else or the page on another dashboard: Thinking, each tool the build calls by
 * name, Building dashboard, and how it ended. It shares that record with the dashboard
 * area (lib/dashboards/build-tracker.ts), so the two always agree.
 *
 * Two separate actions sit under it. "Open dashboard" goes to the dashboard's page.
 * "Refresh data" loads that dashboard's live data again; it never sends a message or
 * builds anything.
 *
 * What it looks like is build-feed.tsx's: the header (BuildCardHeader) and the feed
 * (BuildFeedCard). This is what it does.
 */
export function DashboardBuildCard({ activity, live }: { activity: ToolActivity; /** Its turn is the one running now. */ live: boolean }) {
  const router = useRouter();
  const orgId = useWorkspaceId();
  const { appId, dashboards, onScreen, refresh, refreshDashboard } = useDashboardsOnScreen();

  const edit = activity.toolName === "edit_dashboard";
  // The arguments arrive as the model writes them: a value counts once the next one has begun.
  const input = activity.input as { title?: unknown; description?: unknown; dashboard?: unknown; prompt?: unknown };
  const written = activity.status !== "streaming";
  const result = typeof activity.toolMessage?.content === "string" ? activity.toolMessage.content : undefined;
  /** The call's last result is in: the build is over. */
  const final = result !== undefined;
  const reference = referenceOf(result);
  const refused = final && (!reference || /^Couldn['’]t/i.test(result)) ? failureOf(result) : undefined;
  const stoppedEarlier = refused !== undefined && STOPPED.test(refused);
  const failure = stoppedEarlier ? undefined : refused;

  // A card seen working in this session has a build to follow. One that loads with its
  // result, from the chat's history, doesn't: it's just the dashboard's card.
  const [watched] = useState(() => !final && live);
  const build = useBuild(activity.id);

  // An edit names its dashboard in its arguments, before any result.
  const named = edit && typeof input.dashboard === "string" && (written || "prompt" in input) ? input.dashboard : undefined;
  const targetId = build?.artifactId ?? reference?.id ?? named;

  // The call's side of the build: it started, it has its dashboard's id, it ended.
  const outcome = failure ? "failed" : stoppedEarlier ? "stopped" : final ? "ready" : !live ? "stopped" : undefined;
  useEffect(() => {
    if (!watched) return;
    reportCall(activity.id, { edit, artifactId: reference?.id ?? named, version: reference?.version, outcome, error: failure });
  }, [watched, activity.id, edit, reference?.id, reference?.version, named, outcome, failure]);

  // The stream's side, read here too so the card needs no dashboard on screen: every renderer
  // and card of one dashboard shares a single stream. Only while this card's build runs, and
  // once OpenUI Cloud has said which version it writes.
  const following = watched && !!build?.artifactId && buildActive(build) && (!build.edit || build.version !== undefined);
  const stream = useArtifactStream({ id: following ? build.artifactId : null, version: build?.version });
  // A dropped connection reconnects: it isn't a failed build.
  const streamError = stream.error && stream.error.code !== "network-error" ? stream.error.message : null;
  const hasContent = !!stream.program;
  useEffect(() => {
    if (!following || !build?.artifactId) return;
    reportStream(build.artifactId, { step: stream.step, hasContent, isStreaming: stream.isStreaming, error: streamError });
  }, [following, build?.artifactId, stream.step, hasContent, stream.isStreaming, streamError]);

  const page = targetId ? dashboards.find((dashboard) => dashboard.artifactId === targetId) : undefined;
  // On screen: the dashboard area shows this call's new dashboard, or the dashboard this card is for.
  const viewing = onScreen.callId === activity.id || (!!targetId && onScreen.artifactId === targetId);
  // A later build of the same dashboard (an edit, say) is still writing it.
  const latest = useBuild(null, targetId);
  const rebuilding = !!latest && buildActive(latest);
  const ready = build ? build.phase === "ready" : final && !refused;
  // From the chat's history, a dashboard that has since been deleted: nothing to open.
  const gone = !build && ready && !page;

  // Once a title has been read it stays: a later, cut-off piece of the arguments doesn't take it back.
  const titleNow = edit ? page?.title : typeof input.title === "string" && (written || "description" in input) ? input.title : undefined;
  const [titleSeen, setTitleSeen] = useState(titleNow);
  if (titleNow !== undefined && titleNow !== titleSeen) setTitleSeen(titleNow);
  const title = titleNow ?? titleSeen ?? (edit ? "Dashboard change" : "New dashboard");
  // A card from the chat's history has no build to follow: only how its call ended.
  const settled: SettledStatus =
    refused && !stoppedEarlier
      ? { tone: "error", label: edit ? "Couldn't update" : "Couldn't build" }
      : stoppedEarlier || (!final && !live)
        ? { tone: "idle", label: "Stopped" }
        : gone
          ? { tone: "idle", label: "No longer in this app" }
          : final
            ? { tone: "live", label: edit ? "Updated" : "Ready" }
            : { tone: "busy", label: "Thinking" };
  const canOpen = !!page;
  // Refresh reloads live data, so it waits for a dashboard that's built.
  const canRefresh = ready && !rebuilding && !!targetId && (viewing || canOpen);
  const refreshing = refresh?.artifactId === targetId && refresh?.by === activity.id ? refresh.state : undefined;

  return (
    <div data-build-card className="w-full overflow-hidden rounded-xl border bg-background">
      <BuildCardHeader title={title} edit={edit} build={build} settled={settled} />
      {build && (
        <div className="px-4 pb-3.5">
          <BuildFeedCard build={build} logoFor={toolLogo} />
        </div>
      )}
      {/* Nothing to open or refresh for a build that ended without a dashboard. */}
      {(build ? buildActive(build) || build.phase === "ready" : ready && !gone) && (
        <div className="flex items-center gap-2 border-t bg-foreground/[0.015] px-3 py-2">
          {viewing ? (
            // This card's dashboard is the one on screen now; for any other, "Open dashboard".
            <span className="inline-flex h-7 items-center px-1 text-xs text-muted-foreground">Viewing</span>
          ) : (
            <button
              type="button"
              disabled={!canOpen}
              onClick={() => page && router.push(dashboardPath(orgId, appId, page.id))}
              title={canOpen ? "Go to this dashboard" : "Available once the dashboard has started"}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity duration-150 hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
            >
              Open dashboard
              <Glyph icon={ArrowRightIcon} size={12} />
            </button>
          )}
          <button
            type="button"
            disabled={!canRefresh || refreshing === "running"}
            onClick={() => {
              if (!targetId) return;
              refreshDashboard(targetId, activity.id);
              // Its page loads its data fresh as it opens.
              if (!viewing && page) router.push(dashboardPath(orgId, appId, page.id));
            }}
            title={canRefresh ? "Load this dashboard's live data again. Nothing is rebuilt." : "Available once the dashboard is ready"}
            className="ml-auto inline-flex shrink-0 whitespace-nowrap h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-background"
          >
            {refreshing === "done" ? (
              <Glyph icon={CheckIcon} size={14} className="text-emerald-600" />
            ) : (
              <Glyph icon={RefreshCwIcon} size={14} className={cn(refreshing === "running" && "animate-spin motion-reduce:animate-none")} />
            )}
            <span aria-live="polite">{refreshing === "running" ? "Refreshing…" : refreshing === "done" ? "Updated" : "Refresh data"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
