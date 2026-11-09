import { LayoutDashboardIcon } from "lucide-react";
import Link from "next/link";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shown as chips; the rest collapse into "+N more". */
const VISIBLE = 3;

/**
 * Which apps use a connection or demo dataset, as links to them. It's why
 * the connection can't be deleted, so every row shows it the same way.
 */
export function UsedBy({ apps }: { apps: { id: string; name: string }[] }) {
  if (!apps.length) return null;
  const shown = apps.slice(0, VISIBLE);
  const rest = apps.slice(VISIBLE);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Used by</span>
      {shown.map((app) => (
        <Link
          key={app.id}
          href={`/apps/${app.id}`}
          title={app.name}
          className="inline-flex max-w-48 items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-700 transition-colors hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <LayoutDashboardIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{app.name}</span>
        </Link>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded-md px-1 py-0.5 text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              +{rest.length} more
            </button>
          </TooltipTrigger>
          <TooltipContent>{rest.map((app) => app.name).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
