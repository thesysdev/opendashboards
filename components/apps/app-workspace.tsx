"use client";

import { OpenUICloudProvider } from "@openuidev/react-ui/cloud";
import { PanelRightCloseIcon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { renameAppAction } from "@/app/(app)/apps/actions";
import { InlineRename } from "@/components/inline-rename";
import { OpenSidebarButton } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import { appPath, dashboardPath, frontendTokenPath, parseAppPath } from "@/lib/apps/paths";
import { useWorkspaceId } from "@/lib/apps/use-workspace";
import { cn } from "@/lib/utils";

import { NewDashboard } from "./live-dashboard";

type Dashboard = { id: string; title: string };

const BuildPanelContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/** Whether a Build turn is running, and the Build chat's way to say so. */
const BuildRunningContext = createContext<{ running: boolean; setRunning: (running: boolean) => void } | null>(null);

/**
 * Whether a Build turn is running: a dashboard it creates may still be building.
 * False outside an app's workspace.
 */
export function useBuildRunning(): boolean {
  return use(BuildRunningContext)?.running ?? false;
}

/** For the Build chat: says when a turn starts and ends. */
export function useSetBuildRunning() {
  const context = use(BuildRunningContext);
  if (!context) throw new Error("useSetBuildRunning must be used inside AppWorkspace");
  return context.setRunning;
}

/**
 * A dashboard the Build chat is creating, shown in place of the page it started
 * on (`at`) until the app opens it: pending while the call runs, then streaming
 * from Cloud's `response`.
 */
export type Creating = { at: string; response?: string };

type DashboardResponses = {
  responses: Readonly<Record<string, string>>;
  publish: (artifactId: string, response: string) => void;
  setCreating: Dispatch<SetStateAction<Creating | null>>;
};

const DashboardResponsesContext = createContext<DashboardResponses | null>(null);

function useDashboardResponses() {
  const context = use(DashboardResponsesContext);
  if (!context) throw new Error("Dashboard responses are only available inside AppWorkspace");
  return context;
}

/**
 * The latest create/edit response OpenUI Cloud gave for a dashboard in this
 * session. Passed to its renderer as `response`, it carries the new version,
 * so an open dashboard follows an edit as it's built.
 */
export function useDashboardResponse(artifactId: string): string | undefined {
  return useDashboardResponses().responses[artifactId];
}

/** For the Build chat: hands a create/edit response to the dashboard it's for. */
export function usePublishDashboardResponse() {
  return useDashboardResponses().publish;
}

/** For the Build chat: shows the dashboard it's creating, before the app has a page for it. */
export function useSetCreatingDashboard() {
  return useDashboardResponses().setCreating;
}

const RenameAppContext = createContext<(() => void) | null>(null);

/** Starts renaming the app in place, in the header: for the app's menu. */
export function useRenameApp() {
  const context = use(RenameAppContext);
  if (!context) throw new Error("useRenameApp must be used inside AppWorkspace");
  return context;
}

/** The Build panel's open state, for content inside the workspace. */
export function useBuildPanel() {
  const context = use(BuildPanelContext);
  if (!context) throw new Error("useBuildPanel must be used inside AppWorkspace");
  return context;
}

/**
 * The app's name in the header. Clicking it (or Rename in the app's menu)
 * edits it in place; the new name shows straight away.
 */
function AppTitle({
  appId,
  name,
  renaming,
  onRenamingChange,
}: {
  appId: string;
  name: string;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
}) {
  // A saved name shows until the server's copy catches up.
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null);
  const shown = saved && saved.from === name ? saved.to : name;

  if (renaming) {
    return (
      <h1 className="min-w-0 flex-1 sm:max-w-sm">
        <InlineRename
          value={shown}
          label="App name"
          maxLength={80}
          onSave={(next) => renameAppAction({ id: appId, name: next })}
          onDone={(next) => {
            setSaved(next === name ? null : { from: name, to: next });
            onRenamingChange(false);
          }}
          className="h-7 w-full text-sm font-semibold"
        />
      </h1>
    );
  }
  return (
    <h1 className="min-w-0">
      <button
        type="button"
        onClick={() => onRenamingChange(true)}
        title="Rename"
        className="block max-w-full cursor-text truncate rounded-md px-1.5 py-1 text-left text-sm font-semibold transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {shown}
      </button>
    </h1>
  );
}

/**
 * An app's workspace, shared by all its dashboards: the header, the selected
 * dashboard (the page, as children), and the Build panel on the right, where
 * you ask OpenDashboards to build. The app's dashboards are listed in the main sidebar.
 *
 * It lives in the app's layout, so moving between dashboards keeps the Build
 * panel as it was. It starts open when there's nothing to look at yet, and
 * collapsed once there is.
 */
export function AppWorkspace({
  appId,
  name,
  badges,
  menu,
  builder,
  dashboards,
  notice,
  readOnly = false,
  children,
}: {
  appId: string;
  name: string;
  badges: React.ReactNode;
  menu: React.ReactNode;
  builder: React.ReactNode;
  dashboards: Dashboard[];
  /** For someone who can only view the app: no Build panel and no renaming. */
  readOnly?: boolean;
  /** Shown above the dashboard: a source that needs signing in again, say. */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpenState] = useState(!readOnly && dashboards.length === 0);
  // Opening unmounts the header's Build button and closing hides the panel, so
  // whichever had focus is gone: hand focus to the other side. Only when someone
  // toggles it, not when the workspace first shows.
  const panelRef = useRef<HTMLElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    moveFocus.current = true;
    setOpenState(next);
  }, []);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (open) (panelRef.current?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? closeButtonRef.current)?.focus();
    else openButtonRef.current?.focus();
  }, [open]);
  const buildPanel = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  const [buildRunning, setBuildRunning] = useState(false);
  const buildRunningValue = useMemo(() => ({ running: buildRunning, setRunning: setBuildRunning }), [buildRunning]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const publish = useCallback(
    (artifactId: string, response: string) =>
      setResponses((current) => (current[artifactId] === response ? current : { ...current, [artifactId]: response })),
    [],
  );
  const [creating, setCreating] = useState<Creating | null>(null);
  const dashboardResponses = useMemo(() => ({ responses, publish, setCreating }), [responses, publish]);
  const [renaming, setRenaming] = useState(false);
  const startRename = useCallback(() => setRenaming(true), []);
  // Moving to another page, or to the new dashboard once it opens, hands back to the page.
  const pathname = usePathname();
  // Leaving the page once the response is in means the app opened the new dashboard
  // (or you moved on): it's done, so going back shows that page again.
  if (creating?.response && creating.at !== pathname) setCreating(null);
  const showCreating = creating !== null && creating.at === pathname;

  return (
    // One Cloud connection for the workspace: the chat and the dashboard
    // share its token and artifact cache. The token is this app's own.
    <OpenUICloudProvider token={frontendTokenPath(appId)}>
    <DashboardResponsesContext value={dashboardResponses}>
    <BuildPanelContext value={buildPanel}>
    <BuildRunningContext value={buildRunningValue}>
    <RenameAppContext value={startRename}>
      {/* The Build panel runs the full height beside the dashboard column, header included. */}
      <div className="relative flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <header data-app-header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
            {/* Only while the sidebar is collapsed: it lives here, so nothing is left beside the content. */}
            <OpenSidebarButton />
            {readOnly ? (
              <h1 className="min-w-0 truncate px-1.5 py-1 text-sm font-semibold">{name}</h1>
            ) : (
              <AppTitle appId={appId} name={name} renaming={renaming} onRenamingChange={setRenaming} />
            )}
            <div className="ml-1 hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:flex">{badges}</div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {/* One Build control at a time: this opens the panel, and the panel's own header closes it. */}
              {!open && !readOnly && (
                <Button
                  ref={openButtonRef}
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(true)}
                  aria-expanded={false}
                  aria-controls="app-builder"
                >
                  <SparklesIcon aria-hidden />
                  Build
                </Button>
              )}
              {menu}
            </div>
          </header>

          <MobileDashboardTabs appId={appId} dashboards={dashboards} />
          {notice}
          {showCreating ? <NewDashboard response={creating.response} /> : children}
        </div>

        <aside
          ref={panelRef}
          id="app-builder"
          aria-label="Build"
          className={cn(
            "min-h-0 flex-col border-l bg-background",
            // Beside the dashboard on wide screens, over it below 1024px. Full width
            // (a phone) it covers the app header too; as a 380px sheet it starts under
            // the header, so the app's menu and connections stay in reach.
            "absolute inset-y-0 right-0 z-10 w-full shadow-xl sm:top-12 sm:w-[380px] lg:relative lg:top-0 lg:shadow-none",
            open && !readOnly ? "flex" : "hidden",
          )}
        >
          {/* The chat's thread bar is the panel's header: chat picker, new chat, and
              room on the right for this close button. It's the workspace's, not the
              chat's, so the panel can always be closed, whatever the chat is doing. */}
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-expanded
            aria-controls="app-builder"
            aria-label="Close the Build panel"
            className="absolute top-2.5 right-1.5"
          >
            {/* Over the dashboard (below lg) it closes like a sheet; beside it, it collapses the side panel. */}
            <XIcon className="lg:hidden" aria-hidden />
            <PanelRightCloseIcon className="hidden lg:block" aria-hidden />
          </Button>
          {builder}
        </aside>
      </div>
    </RenameAppContext>
    </BuildRunningContext>
    </BuildPanelContext>
    </DashboardResponsesContext>
    </OpenUICloudProvider>
  );
}

/** Below md there's no sidebar, so the app's dashboards show as a strip of tabs. */
function MobileDashboardTabs({ appId, dashboards }: { appId: string; dashboards: Dashboard[] }) {
  const { dashboardId } = parseAppPath(usePathname());
  const orgId = useWorkspaceId();
  if (!dashboards.length) return null;
  const activeId = dashboardId ?? dashboards[0].id;

  return (
    <nav
      aria-label="Dashboards"
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] md:hidden"
    >
      {dashboards.map((dashboard, index) => (
        <Link
          key={dashboard.id}
          href={index === 0 ? appPath(orgId, appId) : dashboardPath(orgId, appId, dashboard.id)}
          aria-current={dashboard.id === activeId ? "page" : undefined}
          className="shrink-0 rounded-md px-3 py-1 text-sm text-muted-foreground aria-[current=page]:bg-neutral-100 aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          {dashboard.title}
        </Link>
      ))}
    </nav>
  );
}
