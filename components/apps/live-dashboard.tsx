"use client";

import { useArtifactStream } from "@openuidev/react-headless";
import { LiveArtifactRenderer, useArtifactRenderer } from "@openuidev/react-ui/cloud";
import { library } from "@openuidev/dashboard-library";
import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toolLogo } from "@/components/connections/tool-logo";
import { reportStream, useBuild } from "@/lib/dashboards/build-tracker";
import { referenceOf } from "@/lib/dashboards/reference";
import { SIGN_IN_LOST_HEADER } from "@/lib/dashboards/sign-in-lost";
import { cn } from "@/lib/utils";

import { useDashboardResponse, useDashboardsOnScreen } from "./app-workspace";
import { BuildFeedPanel, buildActive } from "./build-feed";
import { DashboardSkeleton } from "./dashboard-skeleton";
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
 * The dashboard the Build chat is creating, in the frame its own page will have: its
 * title and description (from the call until the app has recorded it, `dashboard`), then
 * the dashboard. Without a response the renderer is pending; with one it builds the
 * dashboard. The workspace keeps this one view on screen as the address moves to the
 * dashboard's page, so nothing about it changes then except that its title can be edited.
 */
export function NewDashboard({
  appId,
  buildKey,
  response,
  dashboard,
  title,
  description,
}: {
  appId: string;
  /** The create_dashboard call making it. */
  buildKey: string;
  response?: string;
  dashboard?: { id: string; title: string; description: string | null };
  title?: string;
  description?: string;
}) {
  return (
    <DashboardView response={response} buildKey={buildKey}>
      {dashboard || title ? (
        <DashboardTitle
          appId={appId}
          dashboard={dashboard ?? { id: "", title: title ?? "", description: description ?? null }}
          // Until the app has recorded it there's nothing to rename.
          readOnly={!dashboard}
        />
      ) : (
        <TitlePlaceholder />
      )}
    </DashboardView>
  );
}

/** Where the title and description will be, in DashboardTitle's own box, for a call that hasn't named its dashboard yet. */
function TitlePlaceholder() {
  return (
    <div aria-hidden className="@container bg-white">
      <div className="mx-auto max-w-[1440px] px-4 pt-5 @min-[721px]:px-9 @min-[721px]:pt-6">
        <div className="flex h-[27.5px] items-center">
          <div className="h-5 w-56 max-w-[60%] rounded-md bg-foreground/[0.06]" />
        </div>
        <div className="mt-1.5 flex h-5 items-center">
          <div className="h-3 w-80 max-w-[80%] rounded-md bg-foreground/[0.045]" />
        </div>
      </div>
    </div>
  );
}

/**
 * The dashboard area: `children` (the title) and the renderer in one scrolling box, with
 * the build's progress over it. `buildKey` is the tool call that's making the dashboard,
 * when one is: the area shows that build before the dashboard has an id.
 */
function DashboardView({
  id,
  response,
  buildKey,
  children,
}: {
  id?: string;
  response?: string;
  buildKey?: string;
  children?: React.ReactNode;
}) {
  // Where the loading capsule and an edit's progress draw: over the bottom of the dashboard, outside the part that scrolls.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  // Where the skeleton and a new build's progress draw: over the dashboard, under the title.
  const [coverSlot, setCoverSlot] = useState<HTMLDivElement | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const [headingHeight, setHeadingHeight] = useState(0);
  useLayoutEffect(() => {
    const element = heading.current;
    if (!element) return;
    setHeadingHeight(element.offsetHeight);
    const observer = new ResizeObserver(() => setHeadingHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const content = useRef<HTMLDivElement>(null);

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

  // "Refresh data" on the dashboard's card in the chat: a new `rev` remounts the renderer,
  // which runs its queries again. The area keeps its height meanwhile, so the page stays
  // scrolled where it was. Nothing is generated.
  const artifactId = id ?? referenceOf(response)?.id ?? null;
  const { revs, refresh } = useDashboardsOnScreen();
  const rev = artifactId ? (revs[artifactId] ?? 0) : 0;
  const hold = refresh && refresh.artifactId === artifactId && refresh.state === "running" ? refresh.hold : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div data-dashboard-scroll className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
        <div ref={heading} className="shrink-0">
          {children}
        </div>
        <div data-dashboard-render={artifactId ?? ""} className="flex-[1_0_auto]" style={hold ? { minHeight: hold } : undefined}>
          <LiveArtifactRenderer
            key={rev}
            id={id}
            response={response}
            preview={false}
            library={library}
            interpreter={interpreter}
            onError={(errors) => {
              if (!errors.length) return;
              console.error("[dashboard]", JSON.stringify(errors));
              if (errors.some((error) => error.source === "query")) refreshOnce();
            }}
          >
            <LiveArtifactRenderer.Chrome>
              <BuildReport />
              <div ref={content}>
                <LiveArtifactRenderer.Content className="dashboard-content">
                  {/* The skeleton and the build's progress are BuildCover, over this area, so the
                      renderer's own loader stays out and nothing here moves when content arrives. */}
                  <LiveArtifactRenderer.Pending>
                    <span hidden />
                  </LiveArtifactRenderer.Pending>
                  {/* In place of the renderer's top-right pill, which sat on the filter bar. */}
                  <LoadingCapsule container={overlay} buildKey={buildKey} />
                  <LiveArtifactRenderer.Error />
                </LiveArtifactRenderer.Content>
              </div>
              <BuildCover container={coverSlot} content={content} buildKey={buildKey} />
              <EditFeed container={overlay} buildKey={buildKey} />
            </LiveArtifactRenderer.Chrome>
          </LiveArtifactRenderer>
        </div>
      </div>
      {/* Under the title, which doesn't scroll while there's nothing below it to scroll. */}
      <div ref={setCoverSlot} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: headingHeight }} />
      <div ref={setOverlay} className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2" />
    </div>
  );
}

/**
 * Reports the dashboard's stream to its build (lib/dashboards/build-tracker.ts), as the
 * card in the chat does, and tells that card when a refresh's queries are back.
 */
function BuildReport() {
  const { id, isFetching, error } = useArtifactRenderer();
  // The dashboard's stream itself, shared with the renderer: `isPending` can't stand in for
  // "has content", since it's also false in the moment between the tool's result and the stream.
  const stream = useArtifactStream({ id });
  const { refresh, onRefreshed } = useDashboardsOnScreen();

  // A failed query isn't a failed build; a dropped connection reconnects.
  const failed =
    error && "source" in error && error.source === "artifact" && !("code" in error && error.code === "network-error") ? error.message : null;
  const hasContent = !!stream.program;
  useEffect(() => {
    if (!id) return;
    reportStream(id, { step: stream.step, hasContent, isStreaming: stream.isStreaming, error: failed });
  }, [id, stream.step, hasContent, stream.isStreaming, failed]);

  // A refresh remounted this renderer: its queries run again. Done when they're back, held long
  // enough to be seen; a dashboard with no queries is done after a beat.
  const refreshing = !!id && refresh?.artifactId === id && refresh.state === "running";
  const fetched = useRef(false);
  useEffect(() => {
    if (!refreshing || !id) return;
    if (isFetching) {
      fetched.current = true;
      return;
    }
    const timer = window.setTimeout(() => onRefreshed(id), fetched.current ? 500 : 1500);
    return () => window.clearTimeout(timer);
  }, [refreshing, id, isFetching, onRefreshed]);
  return null;
}

/** Whether the dashboard area has drawn something: a child of real height, not just an empty program. */
function useHasPixels(content: React.RefObject<HTMLDivElement | null>, watch: boolean): boolean {
  const [pixels, setPixels] = useState(false);
  if (!watch && pixels) setPixels(false);
  useEffect(() => {
    if (!watch) return;
    let raf = 0;
    const check = () => {
      const area = content.current?.querySelector(".dashboard-content");
      const drawn = !!area && Array.from(area.children).some((child) => (child as HTMLElement).offsetHeight >= 48);
      if (drawn) setPixels(true);
      else raf = window.requestAnimationFrame(check);
    };
    check();
    return () => window.cancelAnimationFrame(raf);
  }, [content, watch]);
  return pixels;
}

const COVER_EXIT_MS = 320;

/**
 * Over the dashboard area until there's a dashboard to show: the skeleton, and on it what the
 * build is doing. It's an overlay, so the area underneath is laid out as it will be and nothing
 * shifts when the content arrives; it leaves, fading, once the content has drawn. A build that
 * was stopped or failed before anything was written stays here and says so.
 */
function BuildCover({
  container,
  content,
  buildKey,
}: {
  container: HTMLElement | null;
  content: React.RefObject<HTMLDivElement | null>;
  buildKey?: string;
}) {
  const { id, isPending, error } = useArtifactRenderer();
  const stream = useArtifactStream({ id });
  const build = useBuild(buildKey, id);
  const hasContent = !!stream.program;
  // Nothing to show yet: a build that hasn't started writing, or a saved dashboard on its way in.
  // (`isPending` alone flickers off between the tool's first result and the stream connecting.)
  const waiting = isPending || (!hasContent && stream.isStreaming);
  // Once it has covered, it holds until the content has drawn: no blank frame in between.
  const [covered, setCovered] = useState(waiting);
  if (waiting && !covered) setCovered(true);
  const pixels = useHasPixels(content, covered && hasContent);
  // The renderer's own error (a dashboard that can't be loaded) shows in the area underneath.
  // A build of this session that failed before writing anything says so here instead, on the
  // same feed that showed its progress, with the reason.
  const failedBuild = !!build && build.phase === "failed" && !hasContent;
  const blocked = !!error && "source" in error && error.source === "artifact" && !failedBuild;
  // With content, until it has drawn. Without any and nothing more coming, only to say how a
  // build ended.
  const show = !blocked && (waiting || failedBuild || (covered && (hasContent ? !pixels : !!build)));

  // The build's progress shows for a build that's running, or one that ended with nothing
  // written. A dashboard built earlier and just loading again gets the skeleton alone.
  const wantFeed = !!build && (buildActive(build) || !hasContent);
  const [feed, setFeed] = useState(wantFeed);
  if (wantFeed && !feed) setFeed(true);

  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);
  useEffect(() => {
    if (show || !mounted) return;
    const timer = window.setTimeout(() => {
      setMounted(false);
      setCovered(false);
      setFeed(false);
    }, COVER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [show, mounted]);
  if (!mounted || !container) return null;

  const over = !!build && !buildActive(build);
  return createPortal(
    <div
      data-build-cover
      className={cn(
        "absolute inset-0 z-10 bg-white transition-opacity duration-300 ease-out motion-reduce:transition-none",
        show ? "pointer-events-auto opacity-100" : "opacity-0",
      )}
    >
      <DashboardSkeleton still={over} />
      {build && feed && (
        <div className="absolute inset-x-0 top-[18%] z-10 flex justify-center px-4">
          <BuildFeedPanel build={build} logoFor={toolLogo} className="animate-in duration-300 fade-in zoom-in-[0.98] motion-reduce:animate-none" />
        </div>
      )}
    </div>,
    container,
  );
}

/**
 * An edit's progress: the dashboard on screen stays as it is, readable and scrollable, and the
 * build's feed floats over its bottom edge until the new version is in.
 */
function EditFeed({ container, buildKey }: { container: HTMLElement | null; buildKey?: string }) {
  const { id, isPending } = useArtifactRenderer();
  const build = useBuild(buildKey, id);
  const showing = !!build && build.edit && !isPending;
  const active = showing && buildActive(build);
  // "Updated", "Stopped" or "Couldn't update" stays a moment, then leaves.
  const [lingering, setLingering] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      setLingering(true);
      const timer = window.setTimeout(() => setLingering(false), build?.phase === "ready" ? 2200 : 6000);
      wasActive.current = active;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active, build?.phase]);
  if (!container || !showing || !(active || lingering)) return null;
  return createPortal(
    <div data-build-edit-feed className="flex w-full justify-center px-4">
      <BuildFeedPanel
        build={build}
        logoFor={toolLogo}
        className="pointer-events-auto animate-in duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
      />
    </div>,
    container,
  );
}

/**
 * A small capsule at the bottom centre once there's a dashboard on screen: while it's
 * written, then while its data loads or reloads. It waits a moment before showing, so a
 * quick reload doesn't flash it, and fades out when done. Before there's a dashboard the
 * cover says what's happening, and during an edit the feed over the dashboard does.
 */
function LoadingCapsule({ container, buildKey }: { container: HTMLElement | null; buildKey?: string }) {
  const { id, isLoading, isPending, isStreaming, error } = useArtifactRenderer();
  const { refresh } = useDashboardsOnScreen();
  const build = useBuild(buildKey, id);
  if (!container) return null;
  // Until the build starts writing, the renderer can't tell a build that's thinking from a dashboard that's loading.
  const quiet = isPending || build?.phase === "thinking" || (!!build && build.edit && buildActive(build));
  const shown = isLoading && !quiet && !error;
  const refreshing = !!id && refresh?.artifactId === id && refresh.state === "running";
  return createPortal(
    <div
      role="status"
      aria-hidden={!shown}
      className={cn(
        "flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-[opacity,translate] duration-200",
        shown ? "translate-y-0 opacity-100 delay-300" : "translate-y-2 opacity-0",
      )}
    >
      <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      {/* The feed's own words for writing. A saved dashboard streams in too when it opens: that isn't a build. */}
      {isStreaming
        ? build && buildActive(build)
          ? "Building dashboard…"
          : "Loading dashboard…"
        : refreshing
          ? "Refreshing data…"
          : "Loading data…"}
    </div>,
    container,
  );
}
