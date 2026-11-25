import { DatabaseIcon, LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PromptBox } from "@/components/apps/prompt-box";
import { Onboarding } from "@/components/onboarding/onboarding";
import { SectionLabel } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppService, type AppSummary } from "@/lib/apps";
import { getConnectionService } from "@/lib/connections";
import { formatRelative } from "@/lib/format";
import { requireMemberOf } from "@/lib/orgs";
import { appPath } from "@/lib/apps/paths";
import { asWorkspace } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";
import { getSecretMode } from "@/lib/secrets";

export const metadata: Metadata = { title: "Apps" };

type Params = Promise<{ orgId: string }>;

export default function AppsPage({ params }: { params: Params }) {
  return (
    <div className="relative min-h-full">
      {/* A soft glow behind the hero, like a build-anything home page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(0.95_0.03_265)_0%,transparent_70%)]"
      />
      <Suspense fallback={<HomeSkeleton />}>
        <Home params={params} />
      </Suspense>
    </div>
  );
}

/** With no apps yet, onboarding takes the whole page; otherwise the composer and the apps. */
async function Home({ params }: { params: Params }) {
  const member = await requireMemberOf((await params).orgId);
  const connectionService = getConnectionService();
  const [apps, connections] = await Promise.all([getAppService().list(member), connectionService.list(member)]);

  // A viewer only opens what's shared with them: no composer, and nothing to set up.
  if (!can("app", "create", asWorkspace(member.role))) return <SharedApps apps={apps} />;
  if (!apps.length) {
    const [demos, sources] = await Promise.all([connectionService.listDemoDatasets(member), connectionService.offeredSources(member)]);
    return (
      <Onboarding
        connections={connections.map(({ id, name, shortSource, tile, demo }) => ({
          id,
          name,
          source: shortSource,
          tile,
          demo: demo?.key ?? null,
        }))}
        sources={sources}
        demos={demos.map(({ key, name, description, prompts, connectionId }) => ({
          key,
          name,
          description,
          prompts,
          connectionId,
        }))}
        secretMode={getSecretMode()}
      />
    );
  }

  const now = new Date();
  return (
    <>
      <div className="relative mx-auto w-full max-w-3xl px-6 pt-20 sm:pt-28">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-[2.5rem] sm:leading-tight">
          What do you want to build?
        </h1>
        <p className="mx-auto mt-3 max-w-md text-center text-[0.9375rem] text-muted-foreground">
          Describe a dashboard. OpenDashboards builds it from your data connections.
        </p>
        <div className="mt-10">
          <PromptBox connections={connections.map(({ id, name, shortSource }) => ({ id, name, source: shortSource }))} />
        </div>
      </div>

      {/* The grid gets more width than the composer: 3–4 apps per row on wide screens. */}
      <section aria-labelledby="your-apps" className="relative mx-auto mt-20 w-full max-w-7xl px-6 pb-16">
        <SectionLabel id="your-apps">Your apps</SectionLabel>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {apps.map((app) => (
            <li key={app.id}>
              <AppCard app={app} now={now} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** What a viewer sees in place of the composer: the apps their workspace shared with them. */
function SharedApps({ apps }: { apps: AppSummary[] }) {
  const now = new Date();
  return (
    <section aria-labelledby="shared-apps" className="relative mx-auto w-full max-w-7xl px-6 pt-20 pb-16">
      <h1 id="shared-apps" className="text-3xl font-bold tracking-tight">
        Shared with you
      </h1>
      <p className="mt-3 max-w-md text-[0.9375rem] text-muted-foreground">
        You&apos;re a viewer in this workspace: you can open the apps it shares with you. Ask an admin to make you an editor to
        build your own.
      </p>
      {apps.length ? (
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {apps.map((app) => (
            <li key={app.id}>
              <AppCard app={app} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-10 text-sm text-muted-foreground">Nothing has been shared with you yet.</p>
      )}
    </section>
  );
}

function AppCard({ app, now }: { app: AppSummary; now: Date }) {
  const dashboards =
    app.dashboardCount === 1 ? "1 dashboard" : `${app.dashboardCount || "No"} dashboards`;
  return (
    <Link
      href={appPath(app.orgId, app.id)}
      className="flex h-full flex-col gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
          <LayoutDashboardIcon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <p className="text-xs text-muted-foreground">
            {dashboards} · edited {formatRelative(app.updatedAt, now)}
          </p>
          {!app.mine && <p className="truncate text-xs text-muted-foreground">Shared by {app.sharedBy ?? "a member"}</p>}
        </div>
      </div>
      {app.connections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {app.connections.map((connection) => (
            <span
              key={connection.id}
              className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-600"
            >
              <DatabaseIcon className="size-3" aria-hidden />
              {connection.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-3xl px-6 pt-20 sm:pt-28">
      <Skeleton className="mx-auto h-10 w-80" />
      <Skeleton className="mx-auto mt-4 h-4 w-64" />
      <Skeleton className="mt-10 h-[9.5rem] w-full rounded-2xl" />
    </div>
  );
}
