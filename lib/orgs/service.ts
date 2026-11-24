import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/lib/db";
import { appConnections, appGuests, appMembers, apps, dashboards, dataConnections, mcpOAuthSignIns, orgInvites, orgMembers, orgs, users, type OrgRole } from "@/lib/db/schema";
import { logError } from "@/lib/log";

import { roleIn, workspaceFacts } from "./access";
import { fail, fromValidation, internalError, notFound, ok, type OrgResult } from "./errors";
import { decide, refusal, type Decision, type WorkspaceFacts } from "./policy";

export type OrgSummary = {
  id: string;
  name: string;
  role: OrgRole;
};

export type OrgMember = {
  userId: string;
  email: string | null;
  role: OrgRole;
  you: boolean;
  joinedAt: Date;
  /** How many apps they own here: removing them deletes these. */
  appCount: number;
};
export type OrgInvite = { email: string; role: OrgRole; invitedAt: Date };

export type OrgDetail = {
  id: string;
  name: string;
  /** The caller's own role. */
  role: OrgRole;
  members: OrgMember[];
  /** People invited by email who haven't signed in yet. */
  invites: OrgInvite[];
};

/** What the migration named the workspaces of people who were here before workspaces, until we learn their email. */
const PLACEHOLDER_NAME = "My workspace";

/** "rabi's workspace", from the part of the email before the @. */
export function defaultWorkspaceName(email: string): string {
  const who = email.split("@")[0]?.trim().slice(0, 40) || "My";
  return who === "My" ? PLACEHOLDER_NAME : `${who}'s workspace`;
}

const nameSchema = z.string().trim().min(1, "Enter a name.").max(60, "Keep the name under 60 characters.");
const roleSchema = z.enum(["admin", "editor", "viewer"]);
const emailSchema = z
  .string()
  .trim()
  .max(254, "That email is too long.")
  .pipe(z.email("Enter an email address."))
  .transform((email) => email.toLowerCase());

const createSchema = z.object({ name: nameSchema }).strict();
const renameSchema = z.object({ orgId: z.uuid(), name: nameSchema }).strict();
const inviteSchema = z.object({ orgId: z.uuid(), email: emailSchema, role: roleSchema }).strict();
const inviteRefSchema = z.object({ orgId: z.uuid(), email: emailSchema }).strict();
const roleChangeSchema = z.object({ orgId: z.uuid(), userId: z.string().min(1).max(200), role: roleSchema }).strict();
const memberRefSchema = z.object({ orgId: z.uuid(), userId: z.string().min(1).max(200) }).strict();
const orgRefSchema = z.object({ orgId: z.uuid() }).strict();
/** Deleting takes the workspace's name, retyped: there's no undo. */
const deleteSchema = z.object({ orgId: z.uuid(), name: z.string().max(200) }).strict();

/** What a sign-in by someone new to us did. */
export type Arrival = {
  /**
   * null: they'd signed in before. `orgId`: the workspace they start in, theirs
   * or the one that invited them. `createdOrg`: whether it was made for them just now.
   */
  signedUp: { via: "invite" | "guest" | "direct"; orgId: string | null; createdOrg: boolean } | null;
  /** Invites to their email that just became memberships. */
  joined: { orgId: string; role: OrgRole; invitedAt: Date }[];
};

/**
 * Workspaces (orgs) and who is in them. Signing up either joins the
 * workspaces the person was invited to or, with no invite, makes one of their
 * own. Someone can end up in none (removed from their only one): the app then
 * asks them to create one before anything else. Every change checks the
 * caller's own role in the database first.
 */
export function createOrgService({ db }: { db: Database }) {
  async function guard<T>(operation: string, fn: () => Promise<OrgResult<T>>): Promise<OrgResult<T>> {
    try {
      return await fn();
    } catch (error) {
      logError(`orgs.${operation}`, error);
      return internalError();
    }
  }

  /** Asks the policy about the caller in a workspace. */
  async function permit(userId: string, orgId: string, ask: (facts: WorkspaceFacts) => Decision): Promise<OrgResult> {
    const decision = ask(await workspaceFacts(db, userId, orgId));
    return decision.allowed ? ok(undefined) : refusal(decision);
  }

  async function adminCount(orgId: string): Promise<number> {
    const [row] = await db
      .select({ admins: count() })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")));
    return row?.admins ?? 0;
  }

  /** Someone who is no longer a member keeps nothing its apps gave them by name: joining again starts clean. */
  async function forgetAppShares(orgId: string, userId: string): Promise<void> {
    await db
      .delete(appMembers)
      .where(and(eq(appMembers.userId, userId), inArray(appMembers.appId, db.select({ id: apps.id }).from(apps).where(eq(apps.orgId, orgId)))));
  }

  /**
   * Someone no longer in a workspace leaves no sign-in behind: their sign-ins
   * there are deleted with their stored credentials, and taken off any
   * teammate's app that used them, along with sign-ins they had started and
   * not finished. Nobody left could use, renew or delete them. Teammates are
   * asked to sign in themselves. Connections with a key or password stay.
   */
  async function deleteSignIns(orgId: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const theirs = await tx
        .select({ id: dataConnections.id })
        .from(dataConnections)
        .where(
          and(
            eq(dataConnections.orgId, orgId),
            eq(dataConnections.userId, userId),
            sql`${dataConnections.config} -> 'oauth' is not null`,
          ),
        );
      const ids = theirs.map((row) => row.id);
      if (ids.length) {
        await tx.delete(appConnections).where(inArray(appConnections.connectionId, ids));
        await tx.delete(dataConnections).where(inArray(dataConnections.id, ids));
      }
      await tx.delete(mcpOAuthSignIns).where(and(eq(mcpOAuthSignIns.orgId, orgId), eq(mcpOAuthSignIns.userId, userId)));
    });
  }

  /**
   * Whether `actorId` may end `memberId`'s membership: themselves leaving,
   * unless they're its last admin, or an admin removing someone else.
   */
  async function mayDepart(actorId: string, orgId: string, memberId: string): Promise<OrgResult> {
    if (actorId === memberId) {
      const leaving = await permit(actorId, orgId, (f) => decide("workspace", "leave", f));
      if (!leaving.ok) return leaving;
      if ((await roleIn(db, actorId, orgId)) === "admin" && (await adminCount(orgId)) <= 1) {
        return fail({ code: "conflict", message: "You're the only admin. Make someone else an admin before you leave." });
      }
      return ok(undefined);
    }
    const removing = await permit(actorId, orgId, (f) => decide("member", "delete", f));
    if (!removing.ok) return removing;
    if (!(await roleIn(db, memberId, orgId))) return fail({ code: "not_found", message: "This person is no longer a member." });
    return ok(undefined);
  }

  /**
   * Ends someone's membership the same way whether they left or were
   * removed: every app they own in the workspace goes, with its dashboards,
   * chat threads and guests (nobody left could open or delete a private
   * one); their sign-ins there go (`deleteSignIns`); and so do the apps
   * shared with them by name. Connections they added with a key or password
   * stay. The caller has already deleted their dashboards in OpenUI Cloud.
   * False if they weren't a member.
   */
  async function depart(orgId: string, memberId: string): Promise<boolean> {
    const gone = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)))
        .returning({ userId: orgMembers.userId });
      if (removed.length) await tx.delete(apps).where(and(eq(apps.orgId, orgId), eq(apps.userId, memberId)));
      return removed.length > 0;
    });
    if (!gone) return false;
    await forgetAppShares(orgId, memberId);
    await deleteSignIns(orgId, memberId);
    return true;
  }

  /**
   * The workspace to delete, if the caller is an admin of it and retyped its
   * name exactly. Both are checked again by `remove` itself.
   */
  async function deletable(userId: string, input: unknown): Promise<OrgResult<{ orgId: string }>> {
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return notFound();
    const { orgId } = parsed.data;
    const deleting = await permit(userId, orgId, (f) => decide("workspace", "delete", f));
    if (!deleting.ok) return deleting;
    const [org] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (!org) return notFound();
    if (parsed.data.name.trim() !== org.name) {
      return fail({ code: "validation", field: "name", message: "That doesn't match the workspace's name." });
    }
    return ok({ orgId });
  }

  const service = {
    /** Whether this user has signed in before with this email: if not, the caller runs `ensureUser`. */
    async isKnown(user: { id: string; email: string }): Promise<boolean> {
      const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id)).limit(1);
      return row?.email === user.email.toLowerCase();
    },

    /**
     * Records who signed in and turns any invites waiting for their email into
     * memberships. The first time someone signs in: if nothing invited them
     * (and they had nothing from before workspaces), they get a workspace of
     * their own. Safe to repeat.
     *
     * Says what happened, for analytics: whether this was their first sign-in
     * and how they came, and the invites it turned into memberships.
     */
    async ensureUser(user: { id: string; email: string }): Promise<Arrival> {
      const email = user.email.toLowerCase();
      return db.transaction(async (tx): Promise<Arrival> => {
        const [created] = await tx.insert(users).values({ id: user.id, email }).onConflictDoNothing().returning({ id: users.id });
        if (!created) await tx.update(users).set({ email }).where(eq(users.id, user.id));

        // No accept step: an invite to this email is a membership from the first sign-in.
        const invited = await tx.delete(orgInvites).where(eq(orgInvites.email, email)).returning();
        if (invited.length) {
          await tx
            .insert(orgMembers)
            .values(invited.map((invite) => ({ orgId: invite.orgId, userId: user.id, role: invite.role, addedBy: invite.invitedBy })))
            .onConflictDoNothing();
        }
        const joined = invited.map((invite) => ({ orgId: invite.orgId, role: invite.role, invitedAt: invite.createdAt }));
        if (!created) return { signedUp: null, joined };

        const [guest] = await tx.select({ appId: appGuests.appId }).from(appGuests).where(eq(appGuests.email, email)).limit(1);
        const via = invited.length ? "invite" : guest ? "guest" : "direct";

        const memberships = await tx
          .select({ orgId: orgMembers.orgId, name: orgs.name, createdBy: orgs.createdBy })
          .from(orgMembers)
          .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
          .where(eq(orgMembers.userId, user.id));
        if (!memberships.length) {
          // Signed up on their own: a workspace of their own.
          const [org] = await tx
            .insert(orgs)
            .values({ name: defaultWorkspaceName(email), createdBy: user.id })
            .returning({ id: orgs.id });
          await tx.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: "admin", addedBy: user.id });
          return { signedUp: { via, orgId: org.id, createdOrg: true }, joined };
        }
        // Here before workspaces: theirs was made by the migration, which couldn't know their email.
        for (const membership of memberships) {
          if (membership.createdBy === user.id && membership.name === PLACEHOLDER_NAME) {
            await tx.update(orgs).set({ name: defaultWorkspaceName(email) }).where(eq(orgs.id, membership.orgId));
          }
        }
        return { signedUp: { via, orgId: invited[0]?.orgId ?? null, createdOrg: false }, joined };
      });
    },

    /**
     * Moves anything of the user's that has no workspace into their own: the
     * oldest one they created. Never into a workspace they were invited to,
     * which would hand their connections to its members. The migration did this for everything that existed; this
     * catches rows a deployment from before workspaces wrote while this one
     * was rolling out.
     */
    async adoptOrphans(userId: string): Promise<void> {
      const [own] = await db
        .select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
        .where(and(eq(orgMembers.userId, userId), eq(orgs.createdBy, userId)))
        .orderBy(asc(orgs.createdAt))
        .limit(1);
      if (!own) return;
      const { orgId } = own;
      await db.update(apps).set({ orgId }).where(and(eq(apps.userId, userId), isNull(apps.orgId)));
      await db
        .update(dataConnections)
        .set({
          orgId,
          sharing: sql`CASE WHEN ${dataConnections.config} -> 'oauth' IS NOT NULL THEN 'personal'::connection_sharing ELSE 'org'::connection_sharing END`,
        })
        .where(and(eq(dataConnections.userId, userId), isNull(dataConnections.orgId)));
      await db.update(mcpOAuthSignIns).set({ orgId }).where(and(eq(mcpOAuthSignIns.userId, userId), isNull(mcpOAuthSignIns.orgId)));
    },

    /** The workspaces the user is in, the one they've been in longest first. */
    async list(userId: string): Promise<OrgSummary[]> {
      const rows = await db
        .select({ id: orgs.id, name: orgs.name, role: orgMembers.role })
        .from(orgMembers)
        .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, userId))
        .orderBy(asc(orgMembers.createdAt), asc(orgs.id));
      return rows;
    },

    /**
     * Creates a workspace with the caller as its first admin. Without a name
     * it's named after them, which is what the one-click "create my
     * workspace" uses.
     */
    create(user: { id: string; email: string }, input: unknown = { name: defaultWorkspaceName(user.email) }): Promise<OrgResult<{ id: string }>> {
      const userId = user.id;
      return guard("create", async () => {
        const parsed = createSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        return db.transaction(async (tx) => {
          const [org] = await tx.insert(orgs).values({ name: parsed.data.name, createdBy: userId }).returning({ id: orgs.id });
          await tx.insert(orgMembers).values({ orgId: org.id, userId, role: "admin", addedBy: userId });
          return ok({ id: org.id });
        });
      });
    },

    rename(userId: string, input: unknown): Promise<OrgResult> {
      return guard("rename", async () => {
        const parsed = renameSchema.safeParse(input);
        if (!parsed.success) return parsed.error.issues[0]?.path[0] === "name" ? fromValidation(parsed.error) : notFound();
        const renaming = await permit(userId, parsed.data.orgId, (f) => decide("workspace", "update", f));
        if (!renaming.ok) return renaming;
        await db.update(orgs).set({ name: parsed.data.name }).where(eq(orgs.id, parsed.data.orgId));
        return ok(undefined);
      });
    },

    /** An org with its members and pending invites, for any of its members. */
    async get(userId: string, orgId: string): Promise<OrgDetail | null> {
      const facts = await workspaceFacts(db, userId, orgId);
      if (!decide("workspace", "view", facts).allowed || !facts.role) return null;
      const { role } = facts;
      const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
      if (!org) return null;
      const members = await db
        .select({ userId: orgMembers.userId, email: users.email, role: orgMembers.role, joinedAt: orgMembers.createdAt })
        .from(orgMembers)
        .leftJoin(users, eq(users.id, orgMembers.userId))
        .where(eq(orgMembers.orgId, orgId))
        .orderBy(asc(orgMembers.createdAt), asc(orgMembers.userId));
      const owned = new Map(
        (
          await db
            .select({ userId: apps.userId, count: count() })
            .from(apps)
            .where(eq(apps.orgId, orgId))
            .groupBy(apps.userId)
        ).map((row) => [row.userId, row.count]),
      );
      const invites = await db
        .select({ email: orgInvites.email, role: orgInvites.role, invitedAt: orgInvites.createdAt })
        .from(orgInvites)
        .where(eq(orgInvites.orgId, orgId))
        .orderBy(asc(orgInvites.createdAt));
      return {
        id: org.id,
        name: org.name,
        role,
        members: members.map((member) => ({ ...member, you: member.userId === userId, appCount: owned.get(member.userId) ?? 0 })),
        invites,
      };
    },

    /**
     * Adds someone to a workspace by email. Someone who already has an account is a
     * member at once; anyone else becomes one the first time they sign in.
     * Either way there is nothing for them to accept.
     */
    invite(userId: string, input: unknown): Promise<OrgResult<{ status: "added" | "invited" }>> {
      return guard<{ status: "added" | "invited" }>("invite", async () => {
        const parsed = inviteSchema.safeParse(input);
        if (!parsed.success) return parsed.error.issues[0]?.path[0] === "orgId" ? notFound() : fromValidation(parsed.error);
        const { orgId, email, role } = parsed.data;
        // Adding someone: as a member straight away if they have an account, otherwise as an invite. Admins only either way.
        const adding = await permit(userId, orgId, (f) => decide("member", "create", f));
        if (!adding.ok) return adding;

        const known = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        if (!known.length) {
          await db
            .insert(orgInvites)
            .values({ orgId, email, role, invitedBy: userId })
            // Inviting the same email again only changes the role: who invited them first, and when, stay.
            .onConflictDoUpdate({ target: [orgInvites.orgId, orgInvites.email], set: { role } });
          return ok({ status: "invited" as const });
        }
        const added = await db
          .insert(orgMembers)
          .values(known.map((user) => ({ orgId, userId: user.id, role, addedBy: userId })))
          .onConflictDoNothing()
          .returning({ userId: orgMembers.userId });
        if (!added.length) return fail({ code: "conflict", field: "email", message: `${email} is already a member.` });
        return ok({ status: "added" as const });
      });
    },

    revokeInvite(userId: string, input: unknown): Promise<OrgResult> {
      return guard("revokeInvite", async () => {
        const parsed = inviteRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const revoking = await permit(userId, parsed.data.orgId, (f) => decide("invite", "delete", f));
        if (!revoking.ok) return revoking;
        await db.delete(orgInvites).where(and(eq(orgInvites.orgId, parsed.data.orgId), eq(orgInvites.email, parsed.data.email)));
        return ok(undefined);
      });
    },

    /** Changes a member's role. A workspace always keeps at least one admin. */
    changeRole(userId: string, input: unknown): Promise<OrgResult> {
      return guard("changeRole", async () => {
        const parsed = roleChangeSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { orgId, userId: memberId, role } = parsed.data;
        const changing = await permit(userId, orgId, (f) => decide("member", "update", f));
        if (!changing.ok) return changing;
        const current = await roleIn(db, memberId, orgId);
        if (!current) return fail({ code: "not_found", message: "This person is no longer a member." });
        if (current === "admin" && role !== "admin" && (await adminCount(orgId)) <= 1) {
          return fail({ code: "conflict", message: "A workspace needs at least one admin. Make someone else an admin first." });
        }
        await db.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)));
        return ok(undefined);
      });
    },

    /**
     * The OpenUI Cloud dashboards of the apps someone owns in a workspace,
     * which their departure deletes: an admin removing them, or they leaving
     * (`userId` is then their own). Checked as `removeMember` and `leave`
     * check. The caller deletes these in Cloud first, then calls one of them.
     */
    async dashboardsToDeleteOnDeparture(userId: string, input: unknown): Promise<OrgResult<{ artifactIds: string[] }>> {
      const parsed = memberRefSchema.safeParse(input);
      if (!parsed.success) return notFound();
      const { orgId, userId: memberId } = parsed.data;
      const allowed = await mayDepart(userId, orgId, memberId);
      if (!allowed.ok) return allowed;
      const rows = await db
        .select({ artifactId: dashboards.artifactId })
        .from(dashboards)
        .innerJoin(apps, eq(apps.id, dashboards.appId))
        .where(and(eq(apps.orgId, orgId), eq(apps.userId, memberId)));
      return ok({ artifactIds: rows.map((row) => row.artifactId) });
    },

    /** An admin removes someone else from a workspace. It ends as leaving does (`depart`). */
    removeMember(userId: string, input: unknown): Promise<OrgResult> {
      return guard("removeMember", async () => {
        const parsed = memberRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { orgId, userId: memberId } = parsed.data;
        if (memberId === userId) return fail({ code: "conflict", message: "To remove yourself, leave the workspace." });
        const allowed = await mayDepart(userId, orgId, memberId);
        if (!allowed.ok) return allowed;
        return (await depart(orgId, memberId)) ? ok(undefined) : fail({ code: "not_found", message: "This person is no longer a member." });
      });
    },

    /**
     * Someone leaves a workspace. The last admin can't: someone has to be
     * able to manage it. Leaving your only workspace is allowed; the app then
     * asks you to create one. It ends as being removed does (`depart`).
     */
    leave(userId: string, input: unknown): Promise<OrgResult> {
      return guard("leave", async () => {
        const parsed = orgRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { orgId } = parsed.data;
        const allowed = await mayDepart(userId, orgId, userId);
        if (!allowed.ok) return allowed;
        return (await depart(orgId, userId)) ? ok(undefined) : notFound();
      });
    },

    /**
     * What deleting a workspace will destroy outside our database: the
     * OpenUI Cloud artifact of every dashboard in it, whoever made it. For an
     * admin who retyped the name. The caller deletes these first, then calls
     * `remove`.
     */
    async dashboardsToDelete(userId: string, input: unknown): Promise<OrgResult<{ artifactIds: string[] }>> {
      const allowed = await deletable(userId, input);
      if (!allowed.ok) return allowed;
      const rows = await db
        .select({ artifactId: dashboards.artifactId })
        .from(dashboards)
        .innerJoin(apps, eq(apps.id, dashboards.appId))
        .where(eq(apps.orgId, allowed.data.orgId));
      return ok({ artifactIds: rows.map((row) => row.artifactId) });
    },

    /**
     * Deletes a workspace and everything in it, for every member: its apps
     * with their dashboards and chat threads, its connections and their
     * stored credentials, its members and pending invites. Admins only, and
     * only with the workspace's name retyped. There is no undo.
     */
    remove(userId: string, input: unknown): Promise<OrgResult> {
      return guard("remove", async () => {
        const allowed = await deletable(userId, input);
        if (!allowed.ok) return allowed;
        const { orgId } = allowed.data;
        await db.transaction(async (tx) => {
          // Apps first: an app's use of a connection would otherwise block the connection's delete.
          await tx.delete(apps).where(eq(apps.orgId, orgId));
          await tx.delete(dataConnections).where(eq(dataConnections.orgId, orgId));
          // Members, invites and unfinished sign-ins go with the workspace.
          await tx.delete(orgs).where(eq(orgs.id, orgId));
        });
        return ok(undefined);
      });
    },
  };
  return service;
}

export type OrgService = ReturnType<typeof createOrgService>;
