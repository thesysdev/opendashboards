import { and, eq, ne, or, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { appGuests, appMembers, apps, orgMembers, users, type AppMemberAccess, type AppTeamAccess, type OrgRole } from "@/lib/db/schema";

import { can, type AppAccess, type AppFacts, type WorkspaceFacts } from "./policy";

/**
 * The facts the policy (./policy) decides on, loaded from the database: a
 * role is never taken from the caller. Who may do what with them is decided
 * only in the policy.
 *
 * Two things decide how someone gets into an app. The member's role is the
 * ceiling (a viewer never builds), and the app's general access is what its
 * owner granted the rest of the org. The owner always has full access.
 */

/** Who is asking, and in which org. Both come from the verified session, never from the browser. */
export type Scope = { userId: string; orgId: string };

export type { AppAccess };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The caller in a workspace, for the policy. */
export const asWorkspace = (role: OrgRole | null): WorkspaceFacts => ({ kind: "workspace", role });

/** The caller in a workspace, loaded. */
export async function workspaceFacts(db: Database, userId: string, orgId: string | null): Promise<WorkspaceFacts> {
  return asWorkspace(await roleIn(db, userId, orgId));
}

/**
 * A member's access to one app of their org, or null when they have none.
 * `own` is what the app gave them by name, if anything: they get the higher of
 * that and what the whole workspace has.
 */
export function accessFor(
  app: { userId: string; teamAccess: AppTeamAccess },
  userId: string,
  role: OrgRole,
  own: AppMemberAccess | null = null,
): AppAccess | null {
  if (app.userId === userId) return "owner";
  if (app.teamAccess === "private" && !own) return null;
  // The role is the ceiling: a viewer only views, whatever the app grants.
  return (app.teamAccess === "edit" || own === "edit") && role !== "viewer" ? "edit" : "view";
}

/**
 * Whether an app is open to this member of its workspace: it's theirs, it's
 * shared with the workspace, or it was shared with them by name. For queries
 * over `apps`; the caller checks they're a member of the app's org.
 */
export const appOpenTo = (userId: string) =>
  or(
    eq(apps.userId, userId),
    ne(apps.teamAccess, "private"),
    sql<boolean>`exists (select 1 from ${appMembers} where ${appMembers.appId} = ${apps.id} and ${appMembers.userId} = ${userId})`,
  )!;

/** The apps of an org this member can open. */
export const appsOpenTo = ({ userId, orgId }: Scope) => and(eq(apps.orgId, orgId), appOpenTo(userId));

/** An app's facts, from how the caller gets in and their role in its workspace. */
export const asApp = (access: AppAccess | null, role: OrgRole | null, guest = false): AppFacts => ({ kind: "app", role, access, guest });

/** The user's role in an org, or null when they aren't a member. */
export async function roleIn(db: Database, userId: string, orgId: string | null): Promise<OrgRole | null> {
  if (!isUuid(orgId)) return null;
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** An app and the caller's facts about it, whether or not they can get in. */
export type AppRef = { appId: string; orgId: string; ownerId: string; facts: AppFacts };

/** An app the caller can get into. */
export type AppGrant = AppRef & {
  /** Their role in the app's workspace. null: a guest from outside it. */
  role: OrgRole | null;
  access: AppAccess;
  /** Not let in through the workspace: let in to view this app alone, by email. */
  guest: boolean;
  /** Whether they may change the app (the policy's app.update). */
  canChange: boolean;
};

/**
 * An app and how the caller gets in, or null when there's no such app. A
 * member of its workspace gets what their role allows of what the app gives
 * the workspace or gave them by name. Anyone else gets in only as a guest: to
 * view, if the app lists the email they signed in with. Looked up by the
 * app's own workspace, not the one the user has open, so a link to an app
 * works from anywhere.
 */
export async function appFacts(db: Database, userId: string, appId: string): Promise<AppRef | null> {
  if (!isUuid(appId)) return null;
  const [row] = await db
    .select({ orgId: apps.orgId, ownerId: apps.userId, teamAccess: apps.teamAccess, role: orgMembers.role, own: appMembers.access })
    .from(apps)
    .leftJoin(orgMembers, and(eq(orgMembers.orgId, apps.orgId), eq(orgMembers.userId, userId)))
    // What the app gave them by name. It only counts through the membership above.
    .leftJoin(appMembers, and(eq(appMembers.appId, apps.id), eq(appMembers.userId, userId)))
    .where(eq(apps.id, appId))
    .limit(1);
  if (!row?.orgId) return null;
  const { orgId, ownerId, role } = row;
  const access = role ? accessFor({ userId: ownerId, teamAccess: row.teamAccess }, userId, role, row.own) : null;
  if (access) return { appId, orgId, ownerId, facts: asApp(access, role) };
  // Not through the workspace: only as a guest of this app.
  const guest = await isGuest(db, userId, appId);
  return { appId, orgId, ownerId, facts: guest ? asApp("view", role, true) : asApp(null, role) };
}

/** What the caller may do with an app, or null: it doesn't exist, or nothing lets them in. */
export async function appAccess(db: Database, userId: string, appId: string): Promise<AppGrant | null> {
  const ref = await appFacts(db, userId, appId);
  if (!ref?.facts.access) return null;
  const { facts } = ref;
  return { ...ref, role: facts.role, access: facts.access!, guest: facts.guest, canChange: can("app", "update", facts) };
}

/** Whether the app lists the email this user signed in with among its guests. */
export async function isGuest(db: Database, userId: string, appId: string): Promise<boolean> {
  const [row] = await db
    .select({ email: appGuests.email })
    .from(appGuests)
    .innerJoin(users, eq(users.email, appGuests.email))
    .where(and(eq(appGuests.appId, appId), eq(users.id, userId)))
    .limit(1);
  return Boolean(row);
}
