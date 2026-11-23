import { getAppService, type AppTreeNode } from "@/lib/apps";
import type { Member } from "@/lib/orgs";

import { AppsTreeNav } from "./apps-tree-nav";

/**
 * Every app the user can open, in three groups, each newest first with its
 * dashboards nested below: their own in the workspace on screen; the
 * ones teammates shared with that workspace; and the apps of other workspaces
 * they were let into as a guest. A group with nothing in it isn't shown, and
 * the labels only appear once there's more than their own apps to tell apart.
 * The sidebar gives this list the leftover height and scrolls it.
 */
export async function AppsTree({ member }: { member: Member }) {
  const [apps, guestOf] = await Promise.all([getAppService().tree(member), getAppService().sharedWithGuest(member.userId)]);
  const mine = apps.filter((app) => app.mine);
  const workspace = apps.filter((app) => !app.mine);
  const labelled = workspace.length > 0 || guestOf.length > 0;

  return (
    <>
      {labelled && <GroupLabel first>Your apps</GroupLabel>}
      {mine.length ? <AppsTreeNav apps={mine} /> : <p className="py-1.5 pl-7 text-xs text-muted-foreground">No apps yet</p>}
      <Group label={`In ${member.orgName}`} apps={workspace} />
      <Group label="Shared with you" apps={guestOf} />
    </>
  );
}

function Group({ label, apps }: { label: string; apps: AppTreeNode[] }) {
  if (!apps.length) return null;
  return (
    <>
      <GroupLabel>{label}</GroupLabel>
      <AppsTreeNav apps={apps} />
    </>
  );
}

function GroupLabel({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p className={`mb-1 truncate px-2 text-xs font-medium text-muted-foreground ${first ? "mt-1" : "mt-4"}`} title={String(children)}>
      {children}
    </p>
  );
}
