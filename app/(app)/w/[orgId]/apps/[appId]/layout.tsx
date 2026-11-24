import { DatabaseIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AddAppConnection } from "@/components/apps/add-app-connection";
import { AppMenu } from "@/components/apps/app-menu";
import { ShareApp } from "@/components/apps/share-app";
import { SignInAgainBanner, type SignInProblem } from "@/components/apps/sign-in-again-banner";
import { SignInResult } from "@/components/connections/sign-in-result";
import { AppWorkspace } from "@/components/apps/app-workspace";
import { BuildChat } from "@/components/apps/build-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppService, getCurrentUserApp, type AppDetail } from "@/lib/apps";
import { GuestAppMarker } from "@/components/shell/sidebar";
import { memberOf, requireKnownUser } from "@/lib/orgs";
import { can } from "@/lib/orgs/policy";
import { getConnectionService } from "@/lib/connections";

/**
 * The tab shows the app's name, or a dashboard's title. A template only
 * reaches one level down, so this passes the root's on to the dashboards.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgId, appId } = await params;
  const app = await getCurrentUserApp(appId);
  const name = app?.orgId === orgId ? app.name : null;
  return { title: { default: name ?? "App", template: "%s · OpenDashboards" } };
}

type Params = Promise<{ orgId: string; appId: string }>;

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
  const { orgId, appId } = await params;
  const app = await getCurrentUserApp(appId);
  // Only at its own workspace's address.
  if (!app || app.orgId !== orgId) notFound();
  const user = await requireKnownUser();
  const { facts } = app;
  const connections = can("app", "addConnection", facts) ? await getConnectionService().list({ userId: user.id, orgId: app.orgId }) : [];
  const inApp = new Set(app.connections.map((connection) => connection.id));
  const guests = can("guest", "view", facts) ? await getAppService().guests(user.id, app.id) : [];
  const teammates = can("appSharing", "view", facts) ? await getAppService().teammates(user.id, app.id) : [];
  // Whoever can share the app is a member of its workspace.
  const workspace = can("appSharing", "view", facts) ? (await memberOf(app.orgId))?.orgName : null;

  return (
    <>
    {/* A guest came for the dashboard: the sidebar starts collapsed for them. */}
    {app.guest && <GuestAppMarker />}
    <AppWorkspace
      // A fresh workspace per app, so the Build panel's open/closed default applies to each.
      key={app.id}
      appId={app.id}
      name={app.name}
      badges={
        <>
          {/* A guest sees the app, not what the workspace is connected to. */}
          {!app.guest && <ConnectionBadges app={app} />}
          {can("app", "addConnection", facts) && (
            <AddAppConnection
              appId={app.id}
              connections={connections
                .filter((connection) => !inApp.has(connection.id))
                .map(({ id, name, shortSource, tile }) => ({ id, name, source: shortSource, tile }))}
            />
          )}
        </>
      }
      notice={
        <>
          <SignInResult />
          <SignInAgainBanner problems={app.connections.flatMap((connection) => signInProblem(connection))} />
        </>
      }
      // Viewing only: no Build panel, no rename, no menu. The server refuses those anyway.
      readOnly={!can("app", "update", facts)}
      menu={
        can("app", "update", facts) && (
          <>
            {can("appSharing", "update", facts) && (
            <ShareApp
              app={{ id: app.id, name: app.name, teamAccess: app.teamAccess }}
              workspace={workspace ?? "your workspace"}
              owner={{ email: app.ownerEmail ?? "The owner", you: app.access === "owner" }}
              personalConnections={app.connections.filter((connection) => connection.kind === "signInEach").length}
              guests={guests.map(({ email }) => email)}
              teammates={teammates.map(({ userId, email, role, access }) => ({ id: userId, email: email ?? "Someone", viewer: role === "viewer", access }))}
              dashboardCount={app.dashboards.length}
            />
            )}
            <AppMenu
              app={{ id: app.id, name: app.name, dashboardCount: app.dashboards.length }}
              canDelete={can("app", "delete", facts)}
            />
          </>
        )
      }
      builder={
        can("app", "build", facts) && (
          <BuildChat
            appId={app.id}
            dashboards={app.dashboards.map(({ id, artifactId }) => ({ id, artifactId }))}
            hasPendingPrompt={Boolean(app.pendingPrompt)}
          />
        )
      }
      dashboards={app.dashboards.map(({ id, title }) => ({ id, title }))}
    >
      {children}
    </AppWorkspace>
    </>
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

/** What keeps a connection's data from loading for the reader, if anything: one banner row per connection. */
function signInProblem(connection: AppDetail["connections"][number]): SignInProblem[] {
  const { id, name, kind, signInStatus, signedInByMe, signedInAs, canSignIn } = connection;
  const row = (problem: SignInProblem["problem"], by: string | null = null) => [{ id, name, problem, by, canSignIn }];
  if (kind === "key" || signInStatus === "signedIn") return [];
  if (signInStatus === "expired") return signedInByMe ? row("expired") : row("theirsExpired", signedInAs);
  return kind === "signInEach" ? row("notSignedIn") : row("nobody");
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
