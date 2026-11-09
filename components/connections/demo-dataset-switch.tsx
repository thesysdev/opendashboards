"use client";

import { Loader2Icon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { installDemoAction, uninstallDemoAction } from "@/app/(app)/connections/actions";
import { cn } from "@/lib/utils";

/**
 * Installs or uninstalls a demo dataset. Off while any app uses it: those
 * apps' dashboards would break, so the switch says which apps instead.
 */
export function DemoDatasetSwitch({
  dataset,
  name,
  installed,
  apps,
}: {
  dataset: string;
  name: string;
  installed: boolean;
  apps: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const locked = installed && apps.length > 0;

  function toggle() {
    startTransition(async () => {
      const result = installed
        ? await uninstallDemoAction({ dataset })
        : await installDemoAction({ dataset });
      if (result.ok) toast.success(installed ? `${name} uninstalled` : `${name} installed`);
      else toast.error(result.error.message);
    });
  }

  const usedBy = apps.length === 1 ? `Used by ${apps[0].name}` : `Used by ${apps.length} apps`;

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {locked && (
        <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline" title={apps.map((app) => app.name).join(", ")}>
          {usedBy}
        </span>
      )}
      {pending && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      <button
        type="button"
        role="switch"
        aria-checked={installed}
        aria-label={`${installed ? "Uninstall" : "Install"} ${name}`}
        title={locked ? `${usedBy}. Delete those apps to uninstall it.` : undefined}
        disabled={pending || locked}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          installed ? "bg-neutral-900" : "bg-neutral-200",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
            installed ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
