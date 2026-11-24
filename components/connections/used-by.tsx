"use client";

import { ChevronRightIcon, LayoutDashboardIcon } from "lucide-react";
import Link from "next/link";

import { appPath } from "@/lib/apps/paths";
import { useWorkspaceId } from "@/lib/apps/use-workspace";

/**
 * Which apps use a connection or demo dataset: a "Used by" line under its
 * row that opens a compact table, one line per app with an arrow that opens
 * it. It's why the connection can't be deleted. Closed by default so a row
 * stays one line; long lists scroll inside the table.
 */
export function UsedBy({ apps }: { apps: { id: string; name: string }[] }) {
  // A connection's apps are all in its workspace, the one on screen.
  const orgId = useWorkspaceId();
  if (!apps.length) return null;
  return (
    // Indented to line up with the row's text (the 2.5rem tile plus its gap), then out to the row's end.
    <details className="group mt-1.5 ml-[3.25rem]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90" aria-hidden />
        Used by {apps.length === 1 ? "1 app" : `${apps.length} apps`}
      </summary>
      <ul className="mt-1 max-h-[8.25rem] divide-y overflow-y-auto rounded-md border text-xs">
        {apps.map((app) => (
          <li key={app.id}>
            <Link
              href={appPath(orgId, app.id)}
              className="flex items-center gap-2 px-2.5 py-1.5 transition-colors outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <LayoutDashboardIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{app.name}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
