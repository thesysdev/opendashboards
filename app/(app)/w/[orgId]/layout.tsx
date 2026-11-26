import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AnalyticsUser } from "@/components/analytics-user";
import { ViewOnlyBanner, WorkspacePlanProvider, type WorkspacePlan } from "@/components/billing/workspace-plan";
import { AppsTree } from "@/components/shell/apps-tree";
import { Brand } from "@/components/shell/brand";
import { Footer } from "@/components/shell/footer";
import { NavLink } from "@/components/shell/nav-link";
import { RememberWorkspace } from "@/components/shell/remember-workspace";
import { OpenSidebarButton, Sidebar } from "@/components/shell/sidebar";
import { SidebarUser, SidebarUserFallback } from "@/components/shell/sidebar-user";
import { workspacePath } from "@/lib/apps/paths";
import { logError } from "@/lib/log";
import { lastMember, type Member, memberOf, NO_WORKSPACE_PATH, requireKnownUser } from "@/lib/orgs";
import { asWorkspace } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";
import { getPlans } from "@/lib/plans";

type Params = Promise<{ orgId: string }>;

/**
 * Every page of a workspace: the sidebar beside the content. The sidebar is
 * the workspace in the address. For a guest looking at an app of a workspace
 * they aren't in, it's the one they were last in.
 */
export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  // Not awaited: pages render at once, and their plan-aware controls catch up when this arrives.
  const plan = params.then(({ orgId }) => planFor(orgId));
  return (
    <div className="app-shell flex h-dvh bg-neutral-50">
      <Suspense fallback={null}>
        <IdentifyUser />
      </Suspense>
      {/* The brand, the nav and the user. Beside the content on a wide screen, where it can be collapsed; floating over it on a phone. */}
      <Sidebar>
        <Suspense fallback={<SidebarFallback />}>
          <SidebarBody params={params} />
        </Suspense>
      </Sidebar>

      <WorkspacePlanProvider plan={plan}>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Above the page, not in it, so a full-height page still fits the window. */}
          <ViewOnlyBanner />
          {/* With the sidebar collapsed the left margin matches the right (app/globals.css). */}
          <main data-main className="relative mx-2 mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border bg-background md:ml-0">
            {/* The way back to a collapsed sidebar, on pages whose own header doesn't carry one. It stays at
                the top while the page scrolls: on a phone it's the only way to the nav. */}
            <div className="sticky top-0 z-10 h-0">
              <OpenSidebarButton floating className="absolute top-2.5 left-2 bg-background/90 backdrop-blur-sm" />
            </div>
            {children}
          </main>
          <Footer />
        </div>
      </WorkspacePlanProvider>
    </div>
  );
}

/**
 * The workspace's plan for the person viewing it. null when billing is off,
 * or they aren't a member (a guest opening one app): nothing to show them.
 */
async function planFor(orgId: string): Promise<WorkspacePlan> {
  const plans = getPlans();
  const member = plans ? await memberOf(orgId) : null;
  if (!plans || !member) return null;
  try {
    const state = await plans.state(orgId);
    return { ...state, orgId, canManageBilling: can("billing", "update", asWorkspace(member.role)) };
  } catch (error) {
    logError("plans.state", error);
    return null;
  }
}

/** Reads the request, so it streams in behind the boundary. */
async function SidebarBody({ params }: { params: Params }) {
  const { orgId } = await params;
  const here = await memberOf(orgId);
  const last = await lastMember();
  const member: Member | null = here ?? last;
  if (!member) redirect(NO_WORKSPACE_PATH);

  return (
    <>
      {/* Where /apps sends them next time. */}
      {here && last?.orgId !== here.orgId && <RememberWorkspace orgId={here.orgId} />}
      <HomeLink orgId={member.orgId} className="mb-3 flex h-9 shrink-0 items-center px-2" />
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        {/* The home page is where an app starts: its composer, then the app grid. */}
        <NavLink href={workspacePath(member.orgId)} label="New App" icon="new" exact />
        {/* The apps, flat below it, take the leftover height and scroll, so what's below always shows. */}
        <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <AppsTree member={member} />
        </div>
        <div className="shrink-0 border-t pt-2">
          <NavLink href={workspacePath(member.orgId, "connections")} label="Data Connections" icon="connections" />
          <NavLink href={workspacePath(member.orgId, "settings")} label="Workspace" icon="team" />
        </div>
      </nav>
      <div className="mt-1 shrink-0">
        <SidebarUser member={member} />
      </div>
    </>
  );
}

function SidebarFallback() {
  return (
    <>
      <div className="mb-3 flex h-9 shrink-0 items-center px-2">
        <Brand />
      </div>
      <div className="min-h-0 flex-1" />
      <div className="mt-1 shrink-0">
        <SidebarUserFallback />
      </div>
    </>
  );
}

async function IdentifyUser() {
  const user = await requireKnownUser();
  return <AnalyticsUser id={user.id} email={user.email} />;
}

function HomeLink({ orgId, className }: { orgId: string; className?: string }) {
  return (
    <Link
      href={workspacePath(orgId)}
      aria-label="OpenDashboards home"
      className={`rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${className ?? ""}`}
    >
      <Brand />
    </Link>
  );
}
