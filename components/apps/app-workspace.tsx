"use client";

import { ChevronLeftIcon, PanelRightCloseIcon, PanelRightOpenIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, use, useState } from "react";

import { Button } from "@/components/ui/button";
import { appPath, dashboardPath, parseAppPath } from "@/lib/apps/paths";
import { cn } from "@/lib/utils";

type Dashboard = { id: string; title: string };

const BuildPanelContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/** The Build panel's open state, for content inside the workspace. */
export function useBuildPanel() {
  const context = use(BuildPanelContext);
  if (!context) throw new Error("useBuildPanel must be used inside AppWorkspace");
  return context;
}

/**
 * An app's workspace, shared by all its dashboards: the header, the selected
 * dashboard (the page, as children), and the Build panel on the right, where
 * you ask Prism to build. The app's dashboards are listed in the main sidebar.
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
  children,
}: {
  appId: string;
  name: string;
  badges: React.ReactNode;
  menu: React.ReactNode;
  builder: React.ReactNode;
  dashboards: Dashboard[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(dashboards.length === 0);

  return (
    <BuildPanelContext value={{ open, setOpen }}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
          <Link
            href="/apps"
            aria-label="All apps"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
          </Link>
          <h1 className="min-w-0 truncate text-sm font-semibold">{name}</h1>
          <div className="ml-1 hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:flex">{badges}</div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant={open ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="app-builder"
            >
              {open ? <PanelRightCloseIcon aria-hidden /> : <PanelRightOpenIcon aria-hidden />}
              Build
            </Button>
            {menu}
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileDashboardTabs appId={appId} dashboards={dashboards} />
            {children}
          </div>

          <aside
            id="app-builder"
            aria-label="Build"
            className={cn(
              "min-h-0 flex-col border-l bg-background",
              // Beside the dashboard on wide screens, over it below 1024px.
              "absolute inset-y-0 right-0 z-10 w-full shadow-xl sm:w-[380px] lg:static lg:shadow-none",
              open ? "flex" : "hidden",
            )}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
              <span className="flex items-center gap-2 text-sm font-medium">
                <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
                Build
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
                aria-label="Collapse the Build panel"
              >
                <PanelRightCloseIcon aria-hidden />
              </Button>
            </div>
            {builder}
          </aside>
        </div>
      </div>
    </BuildPanelContext>
  );
}

/** Below md there's no sidebar, so the app's dashboards show as a strip of tabs. */
function MobileDashboardTabs({ appId, dashboards }: { appId: string; dashboards: Dashboard[] }) {
  const { dashboardId } = parseAppPath(usePathname());
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
          href={index === 0 ? appPath(appId) : dashboardPath(appId, dashboard.id)}
          aria-current={dashboard.id === activeId ? "page" : undefined}
          className="shrink-0 rounded-md px-3 py-1 text-sm text-muted-foreground aria-[current=page]:bg-neutral-100 aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          {dashboard.title}
        </Link>
      ))}
    </nav>
  );
}
