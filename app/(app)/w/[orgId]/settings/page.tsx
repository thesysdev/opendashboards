import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, SectionLabel } from "@/components/page-header";
import { BillingSection, type BillingView } from "@/components/settings/billing";
import { DangerZone, GuestRow, InviteForm, MemberRow, PendingInviteRow, WorkspaceNameForm } from "@/components/settings/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppService } from "@/lib/apps";
import { getOrgService, requireMemberOf } from "@/lib/orgs";
import { asWorkspace } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";
import { getPlans } from "@/lib/plans";

export const metadata: Metadata = { title: "Workspace settings" };

type Params = Promise<{ orgId: string }>;

export default function WorkspaceSettingsPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <Suspense fallback={<SettingsSkeleton />}>
        <WorkspaceSettings params={params} />
      </Suspense>
    </div>
  );
}

/** Reads the user and the workspace in the address, so it streams in behind the boundary. */
async function WorkspaceSettings({ params }: { params: Params }) {
  const member = await requireMemberOf((await params).orgId);
  const org = await getOrgService().get(member.userId, member.orgId);
  if (!org) notFound();

  const workspace = asWorkspace(org.role);
  // Everyone let in from outside, on any app here: for admins to oversee.
  const guests = can("guest", "viewAll", workspace) ? await getAppService().workspaceGuests(member) : [];
  const admins = org.members.filter((entry) => entry.role === "admin").length;
  // A guest from before they joined: marked, since removing them from the workspace ends it.
  const memberEmails = new Set(org.members.flatMap((entry) => (entry.email ? [entry.email] : [])));
  const billing = await billingView(org.id, can("billing", "update", workspace));
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Everyone in a workspace can use its data connections. Admins manage people; editors build apps and manage connections; viewers only open what's shared with them."
      />

      <section aria-labelledby="workspace-name" className="mb-10">
        <SectionLabel id="workspace-name">General</SectionLabel>
        {can("workspace", "update", workspace) ? (
          <WorkspaceNameForm key={org.name} orgId={org.id} name={org.name} />
        ) : (
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Workspace name</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{org.name}</p>
          </div>
        )}
      </section>

      {billing && (
        <section id="billing" aria-labelledby="billing-title" className="mb-10 scroll-mt-6">
          <SectionLabel id="billing-title">Billing</SectionLabel>
          <BillingSection view={billing} />
        </section>
      )}

      <section aria-labelledby="members">
        <SectionLabel id="members">Members</SectionLabel>
        <div className="rounded-xl border">
          {can("member", "create", workspace) && (
            <div className="rounded-t-xl border-b bg-neutral-50/70 p-3.5">
              <InviteForm orgId={org.id}>
                <p className="mt-2 text-xs text-muted-foreground">
                  There&apos;s nothing to accept: they&apos;re in the workspace as soon as they sign in with that email. We don&apos;t
                  send an email, so let them know.
                </p>
              </InviteForm>
            </div>
          )}
          <ul className="divide-y">
            {org.members.map((entry) => (
              <MemberRow
                key={entry.userId}
                orgId={org.id}
                member={{
                  userId: entry.userId,
                  email: entry.email,
                  role: entry.role,
                  you: entry.you,
                  appCount: entry.appCount,
                  guestAppCount: entry.guestAppCount,
                }}
                // Changing their role and removing them.
                canManage={can("member", "update", workspace) && can("member", "delete", workspace)}
                // A workspace always keeps an admin: the last one can't be demoted.
                lastAdmin={entry.role === "admin" && admins <= 1}
              />
            ))}
            {/* Invited by email and not signed in yet: members-to-be, in the same list. */}
            {org.invites.map((invite) => (
              <PendingInviteRow key={invite.email} orgId={org.id} invite={{ email: invite.email, role: invite.role }} canManage={can("invite", "delete", workspace)} />
            ))}
          </ul>
        </div>
      </section>

      {guests.length > 0 && (
        <section aria-labelledby="guests" className="mt-10">
          <SectionLabel id="guests">Guests</SectionLabel>
          <p className="-mt-1 mb-3 text-sm text-muted-foreground">
            People outside the workspace who can view one of its apps. They see that app and nothing else.
          </p>
          <ul className="divide-y rounded-xl border">
            {guests.map((guest) => (
              <GuestRow
                key={`${guest.appId}:${guest.email}`}
                guest={{
                  appId: guest.appId,
                  appName: guest.appName,
                  email: guest.email,
                  invitedBy: guest.invitedBy,
                  alsoMember: memberEmails.has(guest.email),
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="danger-zone" className="mt-12">
        <SectionLabel id="danger-zone">Danger zone</SectionLabel>
        <DangerZone
          orgId={org.id}
          name={org.name}
          canDelete={can("workspace", "delete", workspace)}
          appCount={org.members.find((entry) => entry.you)?.appCount ?? 0}
        />
      </section>
    </>
  );
}

/** The Billing section's data, or null when billing is off (self-hosted, local). */
async function billingView(orgId: string, canManage: boolean): Promise<BillingView | null> {
  const plans = getPlans();
  if (!plans) return null;
  const overview = await plans.overview(orgId);
  const { subscription } = overview;
  return {
    orgId,
    ...overview,
    subscription: subscription && { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null },
    canManage,
  };
}

function SettingsSkeleton() {
  return (
    <div aria-busy>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-80" />
      <Skeleton className="mt-10 h-[4.25rem] w-full rounded-xl" />
    </div>
  );
}
