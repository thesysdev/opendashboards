"use client";

import { PanelRightOpenIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useBuildPanel } from "./app-workspace";

/**
 * Stands in for the live dashboard until the builder milestone connects
 * OpenUI Cloud: the dashboard's title over the outline of a dashboard.
 */
export function DashboardPlaceholder({ title }: { title: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="relative mt-5">
          <div aria-hidden className="grid gap-3 opacity-60 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl border border-dashed bg-neutral-50" />
            ))}
            <div className="h-64 rounded-xl border border-dashed bg-neutral-50 sm:col-span-2 xl:col-span-3" />
            <div className="h-64 rounded-xl border border-dashed bg-neutral-50 sm:col-span-2 xl:col-span-1" />
            <div className="h-48 rounded-xl border border-dashed bg-neutral-50 sm:col-span-2 xl:col-span-4" />
          </div>
          <div className="absolute inset-x-0 top-28 flex justify-center px-4">
            <p className="rounded-full border bg-background px-3.5 py-1.5 text-center text-xs text-muted-foreground shadow-sm">
              The live dashboard loads here once OpenUI Cloud is connected
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** An app with no dashboards yet. */
export function NoDashboards({ hasPendingPrompt }: { hasPendingPrompt: boolean }) {
  const buildPanel = useBuildPanel();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-neutral-50/60 p-8 text-center">
      <div className="mb-2 flex size-11 items-center justify-center rounded-xl border bg-background">
        <SparklesIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-semibold">Build your first dashboard</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {hasPendingPrompt
          ? "Your prompt is waiting in the Build panel. The dashboards it builds will show up here, and you can keep refining them."
          : "Describe what you want to see in the Build panel. Dashboards show up here, and you can keep refining them by asking."}
      </p>
      {!buildPanel.open && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => buildPanel.setOpen(true)}>
          <PanelRightOpenIcon aria-hidden />
          Open Build panel
        </Button>
      )}
    </div>
  );
}
