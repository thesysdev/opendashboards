"use client";

import { LiveArtifactRenderer, useArtifactRenderer } from "@openuidev/react-ui/cloud";
import { library } from "@openuidev/dashboard-library";
import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SIGN_IN_LOST_HEADER } from "@/lib/dashboards/sign-in-lost";
import { cn } from "@/lib/utils";

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
 * The dashboard the Build chat is creating, before the app has a page for it. Without
 * a response the renderer is pending and shows its loader; with one it builds the
 * dashboard, until the app opens the dashboard's own page.
 */
export function NewDashboard({ response }: { response?: string }) {
  return <DashboardView response={response} fill />;
}

/** `fill`: the renderer takes the whole area, so the pending loader fills it, not just its minimum. */
function DashboardView({
  id,
  response,
  fill = false,
  children,
}: {
  id?: string;
  response?: string;
  fill?: boolean;
  children?: React.ReactNode;
}) {
  // Where the loading capsule draws: over the bottom of the dashboard, outside the part that scrolls.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {children}
        <LiveArtifactRenderer
          id={id}
          response={response}
          preview={false}
          className={cn(fill && "h-full")}
          library={library}
          interpreter={interpreter}
          onError={(errors) => {
            if (!errors.length) return;
            console.error("[dashboard]", JSON.stringify(errors));
            if (errors.some((error) => error.source === "query")) refreshOnce();
          }}
        >
          <LiveArtifactRenderer.Chrome>
            <LiveArtifactRenderer.Content className={cn(fill && "h-full")}>
              <LiveArtifactRenderer.Pending />
              {/* In place of the renderer's top-right pill, which sat on the filter bar. */}
              <LoadingCapsule container={overlay} />
              <LiveArtifactRenderer.Error />
            </LiveArtifactRenderer.Content>
          </LiveArtifactRenderer.Chrome>
        </LiveArtifactRenderer>
      </div>
      <div ref={setOverlay} className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center" />
    </div>
  );
}

/**
 * A small capsule at the bottom centre while the dashboard generates or its data loads. It
 * waits a moment before showing, so a quick reload doesn't flash it, and fades out when done.
 * While pending, the renderer's loader says what's happening instead.
 */
function LoadingCapsule({ container }: { container: HTMLElement | null }) {
  const { isLoading, isPending, isStreaming, error } = useArtifactRenderer();
  if (!container) return null;
  const shown = isLoading && !isPending && !error;
  return createPortal(
    <div
      role="status"
      aria-hidden={!shown}
      className={cn(
        "flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-[opacity,translate] duration-200",
        shown ? "translate-y-0 opacity-100 delay-300" : "translate-y-2 opacity-0",
      )}
    >
      <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
      {isStreaming ? "Building your dashboard…" : "Loading data…"}
    </div>,
    container,
  );
}
