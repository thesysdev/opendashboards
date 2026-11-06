"use client";

import { ChevronRightIcon, LayoutDashboardIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";

import type { AppTreeNode } from "@/lib/apps";
import { appPath, dashboardPath, parseAppPath } from "@/lib/apps/paths";
import { cn } from "@/lib/utils";

/**
 * The sidebar's app tree. The open app is expanded; others expand with their
 * chevron. The highlight reads the URL, so the tree prerenders without it and
 * the highlight streams in.
 */
export function AppsTreeNav({ apps }: { apps: AppTreeNode[] }) {
  return (
    <Suspense fallback={<Tree apps={apps} pathname={null} />}>
      <ActiveTree apps={apps} />
    </Suspense>
  );
}

function ActiveTree({ apps }: { apps: AppTreeNode[] }) {
  return <Tree apps={apps} pathname={usePathname()} />;
}

function Tree({ apps, pathname }: { apps: AppTreeNode[]; pathname: string | null }) {
  const { appId: activeAppId, dashboardId } = parseAppPath(pathname);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeAppId ? [activeAppId] : []));

  // Opening an app (from a card, a link, or this tree) expands it.
  const [lastActive, setLastActive] = useState(activeAppId);
  if (activeAppId !== lastActive) {
    setLastActive(activeAppId);
    if (activeAppId && !expanded.has(activeAppId)) setExpanded(new Set(expanded).add(activeAppId));
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  return (
    <ul aria-label="Your apps" className="flex flex-col gap-0.5">
      {apps.map((app) => {
        const isActiveApp = app.id === activeAppId;
        const isOpen = expanded.has(app.id) && app.dashboards.length > 0;
        // On the app's own page, its first dashboard is the one showing.
        const activeDashboardId = isActiveApp ? (dashboardId ?? app.dashboards[0]?.id) : undefined;

        return (
          <li key={app.id}>
            <div className="group relative">
              <Link
                href={appPath(app.id)}
                aria-current={isActiveApp && !app.dashboards.length ? "page" : undefined}
                title={app.name}
                className={cn(
                  "flex h-8 items-center rounded-lg pr-8 pl-2.5 text-sm text-foreground/70 transition-colors",
                  "hover:bg-black/[0.04] hover:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  isActiveApp && "font-medium text-foreground",
                  isActiveApp && !app.dashboards.length && "bg-black/[0.06]",
                )}
              >
                <span className="truncate">{app.name}</span>
              </Link>
              {app.dashboards.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggle(app.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${app.name}`}
                  className={cn(
                    "absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground transition",
                    "hover:bg-black/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    // Shown on hover or focus; always shown while open.
                    !isOpen && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <ChevronRightIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} aria-hidden />
                </button>
              )}
            </div>

            {isOpen && (
              <ul aria-label={`${app.name} dashboards`} className="mt-0.5 mb-1 flex flex-col gap-0.5">
                {app.dashboards.map((dashboard) => {
                  const active = dashboard.id === activeDashboardId;
                  return (
                    <li key={dashboard.id}>
                      <Link
                        href={dashboardPath(app.id, dashboard.id)}
                        aria-current={active ? "page" : undefined}
                        title={dashboard.title}
                        className={cn(
                          "flex h-7 items-center gap-2 rounded-lg pr-2 pl-4 text-[0.8125rem] text-foreground/65 transition-colors",
                          "hover:bg-black/[0.04] hover:text-foreground",
                          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                          active && "bg-black/[0.06] font-medium text-foreground",
                        )}
                      >
                        <LayoutDashboardIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
                        <span className="truncate">{dashboard.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
