"use client";

import { LiveArtifactRenderer } from "@openuidev/react-ui/cloud";
import { library } from "@openuidev/dashboard-library";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { SIGN_IN_LOST_HEADER } from "@/lib/dashboards/sign-in-lost";

import { useDashboardResponse } from "./app-workspace";
import { DashboardTitle } from "./dashboard-title";

type InterpreterRequest = { id: string; version?: string; name: string; arguments: Record<string, unknown> };

/** An error from the interpreter as the renderer reads it: its message, and its code when there is one. */
function interpreterError(error: unknown, status: number): Error {
  const message =
    typeof error === "string" ? error : typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : null;
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
  return Object.assign(new Error(message ?? `Interpreter request failed: ${status}`), { code });
}

/**
 * A live dashboard from OpenUI Cloud, drawn with @openuidev/dashboard-library, under
 * its title and description (OpenDashboards' own, not part of the program). Its data
 * loads fresh through our interpreter every time it opens. When the Build
 * chat creates or edits it, the renderer gets Cloud's response too, and
 * follows the new version as it's built.
 */
export function LiveDashboard({
  appId,
  dashboard,
  readOnly = false,
}: {
  appId: string;
  dashboard: { id: string; artifactId: string; title: string; description: string | null };
  /** For someone who can only view the app. */
  readOnly?: boolean;
}) {
  const response = useDashboardResponse(dashboard.artifactId);
  return (
    <DashboardView id={dashboard.artifactId} response={response}>
      <DashboardTitle appId={appId} dashboard={dashboard} readOnly={readOnly} />
    </DashboardView>
  );
}

/**
 * The dashboard the Build chat is creating, from the moment its call starts until you leave its
 * page, in one renderer: pending, building, then done, with no remount. Until the app lists it,
 * the pending loader draws where its title and description go.
 */
export function NewDashboard({
  appId,
  dashboard,
  response,
}: {
  appId: string;
  dashboard?: { id: string; title: string; description: string | null };
  response?: string;
}) {
  return (
    <DashboardView response={response} heading={!dashboard}>
      {dashboard && <DashboardTitle appId={appId} dashboard={dashboard} />}
    </DashboardView>
  );
}

function DashboardView({
  id,
  response,
  heading = false,
  children,
}: {
  id?: string;
  response?: string;
  /** No title above it yet: the pending loader draws one. */
  heading?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  // Once per dashboard: a failed query may have just found a sign-in expired, which
  // marks its connection on the server. Refreshing the page's data shows the banner.
  const refreshed = useRef(false);
  const refreshOnce = useCallback(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [router]);
  // Runs data calls through /api/interpreter, as the renderer's own endpoint call does, and also
  // watches for a lost sign-in: a dashboard that catches its query errors still gets the banner.
  const interpreter = useCallback(
    async (request: InterpreterRequest) => {
      const response = await fetch("/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (response.headers.get(SIGN_IN_LOST_HEADER)) refreshOnce();
      const body = (await response.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
      if (!response.ok || (body?.error !== undefined && body.error !== null)) throw interpreterError(body?.error, response.status);
      return body?.result;
    },
    [refreshOnce],
  );
  return (
    // The renderer takes the height under the title, so the pending loader fills it; a taller dashboard scrolls.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
      {children}
      <LiveArtifactRenderer
        id={id}
        response={response}
        preview={false}
        className="flex-1"
        library={library}
        interpreter={interpreter}
        onError={(errors) => {
          if (!errors.length) return;
          console.error("[dashboard]", JSON.stringify(errors));
          if (errors.some((error) => error.source === "query")) refreshOnce();
        }}
      >
        <LiveArtifactRenderer.Chrome>
          <LiveArtifactRenderer.Content className="h-full">
            <LiveArtifactRenderer.Pending heading={heading} />
            {/* "Loading data…" at the bottom of what's visible; a build's feed takes its place. */}
            <LiveArtifactRenderer.Loading />
            <LiveArtifactRenderer.Error />
          </LiveArtifactRenderer.Content>
        </LiveArtifactRenderer.Chrome>
      </LiveArtifactRenderer>
    </div>
  );
}
