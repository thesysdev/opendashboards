import { DatabaseIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppMenu } from "@/components/apps/app-menu";
import { AppWorkspace } from "@/components/apps/app-workspace";
import { BuildChat } from "@/components/apps/build-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUserApp, type AppDetail } from "@/lib/apps";

/**
 * The tab shows the app's name, or a dashboard's title. A template only
 * reaches one level down, so this passes the root's on to the dashboards.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { appId } = await params;
  const app = await getCurrentUserApp(appId);
  return { title: { default: app?.name ?? "App", template: "%s · Prism" } };
}

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
      builder={
        <BuildChat
          appId={app.id}
          dashboards={app.dashboards.map(({ id, artifactId }) => ({ id, artifactId }))}
          hasPendingPrompt={Boolean(app.pendingPrompt)}
        />
      }
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
