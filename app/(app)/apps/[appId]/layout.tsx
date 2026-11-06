import { ArrowUpIcon, DatabaseIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppMenu } from "@/components/apps/app-menu";
import { AppWorkspace } from "@/components/apps/app-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUserApp, type AppDetail } from "@/lib/apps";

export const metadata: Metadata = { title: "App" };

type Params = Promise<{ appId: string }>;

/**
 * The chrome shared by an app's pages: header, Build panel, and the mobile
 * dashboard tabs. Each page renders one dashboard (or the empty state).
 */
export default function AppLayout({ params, children }: { params: Params; children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <AppView params={params}>{children}</AppView>
    </Suspense>
  );
}

async function AppView({ params, children }: { params: Params; children: React.ReactNode }) {
  const { appId } = await params;
  const app = await getCurrentUserApp(appId);
  if (!app) notFound();

  return (
    <AppWorkspace
      // A fresh workspace per app, so the Build panel's open/closed default applies to each.
      key={app.id}
      appId={app.id}
      name={app.name}
      badges={<ConnectionBadges app={app} />}
      menu={<AppMenu app={{ id: app.id, name: app.name, dashboardCount: app.dashboards.length }} />}
      builder={<BuilderPlaceholder app={app} />}
      dashboards={app.dashboards.map(({ id, title }) => ({ id, title }))}
    >
      {children}
    </AppWorkspace>
  );
}

function ConnectionBadges({ app }: { app: AppDetail }) {
  return app.connections.map((connection) => (
    <span
      key={connection.id}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-600"
    >
      <DatabaseIcon className="size-3" aria-hidden />
      {connection.name}
    </span>
  ));
}

/** Stands in for Agent Interface until the builder milestone. */
function BuilderPlaceholder({ app }: { app: AppDetail }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {app.pendingPrompt ? (
          <>
            <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
              <div className="rounded-2xl rounded-br-md bg-neutral-100 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                {app.pendingPrompt}
              </div>
              {app.pendingConnections.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {app.pendingConnections.map((connection) => (
                    <span
                      key={connection.id}
                      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground"
                    >
                      <DatabaseIcon className="size-3" aria-hidden />
                      {connection.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Building is coming next. This prompt is saved and will be sent first.
            </p>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <SparklesIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">
              {app.dashboards.length ? "Change or add dashboards" : "Ask for a dashboard"}
            </p>
            <p className="text-sm text-muted-foreground">
              {app.dashboards.length
                ? "Ask for a new chart, a filter, or a whole new dashboard. Building is coming next."
                : "Describe what you want to see and Prism builds it from your data. Building is coming next."}
            </p>
          </div>
        )}
      </div>
      <div className="border-t p-3">
        <div
          aria-disabled
          className="flex items-center gap-2 rounded-xl border bg-neutral-50 px-3 py-2 text-sm text-muted-foreground"
        >
          <span className="flex-1">Message Prism…</span>
          <span className="flex size-7 items-center justify-center rounded-full bg-neutral-200 text-neutral-500">
            <ArrowUpIcon className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-1">
        <div className="hidden w-52 border-r md:block" />
        <div className="flex-1 bg-neutral-50/60" />
      </div>
    </div>
  );
}
