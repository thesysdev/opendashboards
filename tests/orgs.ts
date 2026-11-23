import { createHash } from "node:crypto";

import type { Database } from "@/lib/db";
import { orgMembers, orgs, users } from "@/lib/db/schema";
import type { Scope } from "@/lib/orgs/access";

/** A stable workspace id for a name, so a test can name a workspace before it exists. */
export function orgIdFor(name: string): string {
  const hex = createHash("md5").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A test user in a workspace of their own: what the services take where they need a workspace. */
export const workspaceOf = (userId: string): Scope => ({ userId, orgId: orgIdFor(`own:${userId}`) });

/**
 * Makes sure each test user exists with a workspace of their own that they're
 * the admin of, as signing up without an invite would give them. Safe to
 * repeat: tests truncate apps and connections, and re-seed after truncating
 * workspaces.
 */
export async function seedWorkspaces(db: Database, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    const { orgId } = workspaceOf(userId);
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` }).onConflictDoNothing();
    await db.insert(orgs).values({ id: orgId, name: `${userId}'s workspace`, createdBy: userId }).onConflictDoNothing();
    await db.insert(orgMembers).values({ orgId, userId, role: "admin", addedBy: userId }).onConflictDoNothing();
  }
}

/** A workspace with the given members, by role. Returns its id. */
export async function seedTeam(
  db: Database,
  name: string,
  members: Record<string, "admin" | "editor" | "viewer">,
): Promise<string> {
  const orgId = orgIdFor(`team:${name}`);
  // Nobody's own: created by a stand-in, so it's never where anyone's old rows are moved.
  await db.insert(orgs).values({ id: orgId, name, createdBy: "seed" }).onConflictDoNothing();
  for (const [userId, role] of Object.entries(members)) {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` }).onConflictDoNothing();
    await db
      .insert(orgMembers)
      .values({ orgId, userId, role, addedBy: "seed" })
      .onConflictDoUpdate({ target: [orgMembers.orgId, orgMembers.userId], set: { role } });
  }
  return orgId;
}
