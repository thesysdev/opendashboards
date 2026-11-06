"use client";

import { library } from "@prism/dashboard-kit";
import { Renderer } from "@openuidev/react-lang";
import { useSyncExternalStore } from "react";

import "@prism/dashboard-kit/styles.css";

const subscribe = () => () => {};

/**
 * Renders an OpenUI Lang program with Prism's dashboard kit, for the /kit
 * development pages.
 *
 * Client-only: react-lang 1.1 sets `$state` defaults in an effect, so a server
 * render evaluates every filtered value as null and paints "No data" until
 * hydration. A skeleton is honest about that wait.
 */
export function KitDashboard({ source }: { source: string }) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white">
      {mounted ? (
        <Renderer
          response={source}
          library={library}
          onError={(errors) => {
            if (errors.length) console.error("[mock dashboard]", errors);
          }}
        />
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto flex max-w-[1440px] animate-pulse flex-col gap-6 px-8 pt-7 pb-12"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="flex flex-col gap-2">
        <div className="h-6 w-64 rounded-md bg-zinc-100" />
        <div className="h-4 w-96 max-w-full rounded-md bg-zinc-100" />
      </div>
      <div className="h-8 w-72 rounded-lg bg-zinc-100" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[118px] rounded-xl border border-zinc-100 bg-zinc-50" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-[340px] rounded-xl border border-zinc-100 bg-zinc-50 xl:col-span-2" />
        <div className="h-[340px] rounded-xl border border-zinc-100 bg-zinc-50" />
      </div>
    </div>
  );
}
