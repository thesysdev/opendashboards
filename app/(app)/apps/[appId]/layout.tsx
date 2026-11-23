import { DatabaseIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AddAppConnection } from "@/components/apps/add-app-connection";
import { AppMenu } from "@/components/apps/app-menu";
import { ShareApp } from "@/components/apps/share-app";
import { SignInAgainBanner } from "@/components/apps/sign-in-again-banner";
import { SignInResult } from "@/components/connections/sign-in-result";
import { AppWorkspace } from "@/components/apps/app-workspace";
import { BuildChat } from "@/components/apps/build-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppService, getCurrentUserApp, type AppDetail } from "@/lib/apps";
import { OpenAppOrg } from "@/components/shell/open-app-org";
import { GuestAppMarker } from "@/components/shell/sidebar";
import { requireMember } from "@/lib/orgs";
import { getConnectionService } from "@/lib/connections";

/**
 * The tab shows the app's name, or a dashboard's title. A template only
 * reaches one level down, so this passes the root's on to the dashboards.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { appId } = await params;
  const app = await getCurrentUserApp(appId);
  return { title: { default: app?.name ?? "App", template: "%s · OpenDashboards" } };
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
  const member = await requireMember();
  // The connections of the app's own org, whichever org the user had open.
  const connections = app.canChange ? await getConnectionService().list({ userId: member.userId, orgId: app.orgId }) : [];
  const inApp = new Set(app.connections.map((connection) => connection.id));
  const guests = app.canChange ? await getAppService().guests(member.userId, app.id) : [];
  const teammates = app.canChange ? await getAppService().teammates(member.userId, app.id) : [];

  return (
    <>
    {/* A guest came for the dashboard: the sidebar starts collapsed for them. */}
    {app.guest && <GuestAppMarker />}
    {/* A guest isn't in the app's workspace, so there's nothing of theirs to open there. */}
    {!app.guest && member.orgId !== app.orgId && <OpenAppOrg orgId={app.orgId} />}
    <AppWorkspace
      // A fresh workspace per app, so the Build panel's open/closed default applies to each.
      key={app.id}
      appId={app.id}
      name={app.name}
      badges={
        <>
          {/* A guest sees the app, not what the workspace is connected to. */}
          {!app.guest && <ConnectionBadges app={app} />}
          {app.canChange && (
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
          <SignInAgainBanner
            connections={app.connections
              // Signing in again is for whoever signed in: a teammate's sign-in isn't theirs to renew.
              .filter((connection) => connection.signIn === "oauth" && connection.status === "invalid" && connection.mine)
              .map(({ id, name }) => ({ id, name }))}
            // A sign-in shared with the workspace is its owner's to renew: everyone else is told who to ask.
            expired={app.connections
              .filter((connection) => connection.signIn === "oauth" && connection.status === "invalid" && !connection.mine && connection.sharing === "org")
              .map(({ id, name, ownerEmail }) => ({ id, name, owner: ownerEmail }))}
            // A guest can't sign in to a workspace's sources: only its members can.
            others={app.guest ? [] : app.connections.filter((connection) => connection.needsSignIn).map(({ id, name }) => ({ id, name }))}
          />
        </>
      }
      // Viewing only: no Build panel, no rename, no menu. The server refuses those anyway.
      readOnly={!app.canChange}
      menu={
        app.canChange && (
          <>
            <ShareApp
              app={{ id: app.id, name: app.name, teamAccess: app.teamAccess }}
              workspace={member.orgs.find((org) => org.id === app.orgId)?.name ?? "your workspace"}
              owner={{ email: app.ownerEmail ?? "The owner", you: app.access === "owner" }}
              personalConnections={app.connections.filter((connection) => connection.sharing === "personal").length}
              guests={guests.map(({ email }) => email)}
              teammates={teammates.map(({ userId, email, role, access }) => ({ id: userId, email: email ?? "Someone", viewer: role === "viewer", access }))}
              dashboardCount={app.dashboards.length}
            />
            <AppMenu
              app={{ id: app.id, name: app.name, dashboardCount: app.dashboards.length }}
              canDelete={app.access === "owner"}
            />
          </>
        )
      }
      builder={
        app.canChange && (
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
