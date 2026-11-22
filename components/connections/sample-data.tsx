"use client";

import { EllipsisIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { installDemoAction, uninstallDemoAction } from "@/app/(app)/connections/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { SourceTile } from "./source-tile";

/** Adds a sample dataset as a connection. Only adds it: building is the row's Build button. */
function useAddSampleData(dataset: string, name: string) {
  const [pending, startTransition] = useTransition();
  function add() {
    startTransition(async () => {
      const result = await installDemoAction({ dataset });
      if (result.ok) toast.success(`${name} added`);
      else toast.error(result.error.message);
    });
  }
  return { pending, add };
}

/** The empty state's button: "Add sample data". */
export function AddSampleDataButton({ dataset, name }: { dataset: string; name: string }) {
  const { pending, add } = useAddSampleData(dataset, name);
  return (
    <Button variant="outline" size="sm" onClick={add} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
      Add sample data
    </Button>
  );
}

/** A tile in the Add a connection catalog, for someone who already has connections. */
export function SampleDataTile({ dataset, name, summary }: { dataset: string; name: string; summary: string }) {
  const { pending, add } = useAddSampleData(dataset, name);
  return (
    <button
      type="button"
      onClick={add}
      disabled={pending}
      className="flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-neutral-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
    >
      <SourceTile label="DM" className="size-9" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          Sample data
          {pending && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span>
      </span>
    </button>
  );
}

/**
 * A sample dataset row's menu. It can't be edited, only removed, and not
 * while an app uses it, the same rule as deleting a connection.
 */
export function SampleDataActions({
  dataset,
  name,
  apps,
}: {
  dataset: string;
  name: string;
  apps: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const inUse = apps.length > 0;

  function remove() {
    startTransition(async () => {
      const result = await uninstallDemoAction({ dataset });
      if (result.ok) toast.success(`${name} removed`);
      else toast.error(result.error.message);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <EllipsisIcon aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem variant="destructive" onSelect={remove} disabled={pending || inUse}>
          <Trash2Icon aria-hidden />
          <span className="flex flex-col">
            Remove
            {inUse && (
              <span className="text-xs text-muted-foreground">
                {apps.length === 1 ? "1 app uses it" : `${apps.length} apps use it`}. Delete {apps.length === 1 ? "it" : "them"} to remove it.
              </span>
            )}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
