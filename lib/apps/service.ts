import { and, asc, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import {
  appConnections,
  appGuests,
  appMembers,
  apps,
  dashboards,
  dataConnections,
  orgMembers,
  users,
  type AppMemberAccess,
  type AppTeamAccess,
  type OrgRole,
  type ConnectionSharing,
  type ConnectionStatus,
} from "@/lib/db/schema";
import type { ConnectionType } from "@/lib/sources/catalog";
import { logError } from "@/lib/log";
import { accessFor, appAccess, appsOpenTo, canBuild, canChange, canManageMembers, roleIn, type AppAccess, type Scope } from "@/lib/orgs/access";

import { fail, forbidden, fromValidation, internalError, notFound, ok, type AppResult } from "./errors";
import {
  addAppConnectionSchema,
  appGuestSchema,
  appIdSchema,
  appMemberRefSchema,
  appMemberSchema,
  appRefSchema,
  createAppSchema,
  renameAppSchema,
  teamAccessSchema,
} from "./schemas";

export type AppConnectionBadge = { id: string; name: string };

export type AppSummary = {
  id: string;
  /** Its workspace, for its address. */
  orgId: string;
  name: string;
  updatedAt: Date;
  dashboardCount: number;
  connections: AppConnectionBadge[];
  /** Whether the caller owns it; otherwise it was shared with their workspace. */
  mine: boolean;
  /** Its owner's email, when that isn't the caller. */
  sharedBy: string | null;
};

/** Someone outside the workspace who may view an app. */
export type AppGuest = { email: string; invitedBy: string | null; invitedAt: Date };

/**
 * A member of the app's workspace, other than its owner, as the Share dialog
 * lists them: what the app gave them by name, if anything.
 */
export type AppTeammate = { userId: string; email: string | null; role: OrgRole; access: AppMemberAccess | null };

/** A guest of an app, as a workspace's admins see them: on which app. */
export type WorkspaceGuest = AppGuest & { appId: string; appName: string };

/** How many people outside the workspace may view one app. */
export const MAX_GUESTS_PER_APP = 50;

export type AppTreeNode = {
  id: string;
  /** Its workspace, for its address. A guest's app is in a workspace they aren't in. */
  orgId: string;
  name: string;
  /** Whether the caller owns it. Otherwise a teammate shared it with the workspace, or they're its guest. */
  mine: boolean;
  /** Whether the caller may rename or delete its dashboards. False when they can only view it. */
  canChange: boolean;
  dashboards: { id: string; title: string }[];
};

export type AppDetail = {
  id: string;
  name: string;
  /** The org it belongs to. */
  orgId: string;
  /** Its owner's email, for whoever shares it. */
  ownerEmail: string | null;
  /** What the caller may do with it. */
  access: AppAccess;
  /** Whether the caller may build in it: chat, rename, change its dashboards. Never true for a viewer. */
  canChange: boolean;
  /** The caller is a guest: not in the app's workspace, let in to view this app alone. */
  guest: boolean;
  /** How many people outside the workspace can view it. */
  guestCount: number;
  /** How many teammates it's shared with by name. */
  teammateCount: number;
  teamAccess: AppTeamAccess;
  pendingPrompt: string | null;
  /** The data sources picked for the pending prompt, by name. */
  pendingConnections: AppConnectionBadge[];
  createdAt: Date;
  updatedAt: Date;
  dashboards: { id: string; title: string; description: string | null; artifactId: string; position: number }[];
  connections: (AppConnectionBadge & {
    type: ConnectionType;
    status: ConnectionStatus;
    signIn: "oauth" | null;
    sharing: ConnectionSharing;
    /** Whether the caller added it (for a sign-in: whether it's theirs). */
    mine: boolean;
    /**
     * Someone else's personal sign-in, and the caller has none of their own
     * to that server: its dashboards stay empty for them until they sign in.
     */
    needsSignIn: boolean;
    /**
     * Someone else's personal sign-in that runs as the caller's own sign-in
     * to the same server, which has expired: the id of the caller's own, for
     * them to sign in to again. Null otherwise.
     */
    expiredOwnSignIn: string | null;
    /**
     * Whose it is, when it's a teammate's: who to ask when a sign-in shared
     * with the workspace expires. Null for the caller's own, and for a guest,
     * who isn't told who is in the workspace.
     */
    ownerEmail: string | null;
  })[];
};

/**
 * The data access layer for apps. An app belongs to an org and has an owner.
 * Who may see or change it is decided by lib/orgs/access, from the database:
 * an app the caller can't open looks exactly like a missing one.
 */
export function createAppService({ db, now = () => new Date() }: { db: Database; now?: () => Date }) {
  async function guard<T>(operation: string, fn: () => Promise<AppResult<T>>): Promise<AppResult<T>> {
    try {
      return await fn();
    } catch (error) {
      logError(`apps.${operation}`, error);
      return internalError();
    }
  }

  /** The apps of an org this member can open: their own, the ones shared with the team, and the ones shared with them by name. */
  const visibleTo = appsOpenTo;

  /** The connections of an org this member can query: the org's, and their own sign-ins. */
  const usableBy = ({ userId, orgId }: Scope) =>
    and(eq(dataConnections.orgId, orgId), or(eq(dataConnections.sharing, "org"), eq(dataConnections.userId, userId)));

  async function connectionBadges(appIds: string[]) {
    if (!appIds.length) return [];
    return db
      .select({
        appId: appConnections.appId,
        id: dataConnections.id,
        name: dataConnections.name,
        type: dataConnections.type,
        status: dataConnections.status,
        config: dataConnections.config,
        sharing: dataConnections.sharing,
        ownerId: dataConnections.userId,
      })
      .from(appConnections)
      .innerJoin(dataConnections, eq(dataConnections.id, appConnections.connectionId))
      .where(inArray(appConnections.appId, appIds))
      .orderBy(asc(dataConnections.name));
  }

  const service = {
    /** The apps in the org the member can open, most recently updated first. */
    async list(scope: Scope, { limit }: { limit?: number } = {}): Promise<AppSummary[]> {
      if (!(await roleIn(db, scope.userId, scope.orgId))) return [];
      const query = db
        .select({
          id: apps.id,
          name: apps.name,
          updatedAt: apps.updatedAt,
          ownerId: apps.userId,
          ownerEmail: users.email,
          dashboardCount: count(dashboards.id),
        })
        .from(apps)
        .leftJoin(dashboards, eq(dashboards.appId, apps.id))
        .leftJoin(users, eq(users.id, apps.userId))
        .where(visibleTo(scope))
        .groupBy(apps.id, users.email)
        .orderBy(desc(apps.updatedAt), desc(apps.id));
      const rows = limit ? await query.limit(limit) : await query;

      const badges = await connectionBadges(rows.map((row) => row.id));
      return rows.map(({ ownerId, ownerEmail, ...row }) => ({
        ...row,
        orgId: scope.orgId,
        mine: ownerId === scope.userId,
        sharedBy: ownerId === scope.userId ? null : ownerEmail,
        connections: badges
          .filter((badge) => badge.appId === row.id)
          .map(({ id, name }) => ({ id, name })),
      }));
    },

    /** Apps with their dashboards' titles, for the sidebar tree. Newest app first. */
    async tree(scope: Scope): Promise<AppTreeNode[]> {
      const role = await roleIn(db, scope.userId, scope.orgId);
      if (!role) return [];
      const appRows = await db
        .select({ id: apps.id, name: apps.name, userId: apps.userId, teamAccess: apps.teamAccess })
        .from(apps)
        .where(visibleTo(scope))
        .orderBy(desc(apps.updatedAt), desc(apps.id));
      if (!appRows.length) return [];
      const appIds = appRows.map((app) => app.id);

      const dashboardRows = await db
        .select({ appId: dashboards.appId, id: dashboards.id, title: dashboards.title })
        .from(dashboards)
        .where(inArray(dashboards.appId, appIds))
        .orderBy(asc(dashboards.position), asc(dashboards.createdAt));
      // What each app gave this member by name.
      const own = new Map(
        (
          await db
            .select({ appId: appMembers.appId, access: appMembers.access })
            .from(appMembers)
            .where(and(eq(appMembers.userId, scope.userId), inArray(appMembers.appId, appIds)))
        ).map((row) => [row.appId, row.access]),
      );

      return appRows.map(({ userId: ownerId, teamAccess, ...app }) => ({
        ...app,
        orgId: scope.orgId,
        mine: ownerId === scope.userId,
        canChange: canChange(accessFor({ userId: ownerId, teamAccess }, scope.userId, role, own.get(app.id) ?? null) ?? "view", role),
        dashboards: dashboardRows
          .filter((dashboard) => dashboard.appId === app.id)
          .map(({ id, title }) => ({ id, title })),
      }));
    },

    async get(userId: string, appId: string): Promise<AppDetail | null> {
      const grant = await appAccess(db, userId, appId);
      if (!grant) return null;
      const [app] = await db
        .select({
          id: apps.id,
          name: apps.name,
          teamAccess: apps.teamAccess,
          pendingPrompt: apps.pendingPrompt,
          pendingConnectionIds: apps.pendingConnectionIds,
          createdAt: apps.createdAt,
          updatedAt: apps.updatedAt,
        })
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);
      if (!app) return null;

      const appDashboards = await db
        .select({
          id: dashboards.id,
          title: dashboards.title,
          description: dashboards.description,
          artifactId: dashboards.artifactId,
          position: dashboards.position,
        })
        .from(dashboards)
        .where(eq(dashboards.appId, app.id))
        .orderBy(asc(dashboards.position), asc(dashboards.createdAt));

      const pendingIds = app.pendingConnectionIds ?? [];
      const pendingConnections = pendingIds.length
        ? await db
            .select({ id: dataConnections.id, name: dataConnections.name })
            .from(dataConnections)
            .where(and(usableBy({ userId, orgId: grant.orgId }), inArray(dataConnections.id, pendingIds)))
            .orderBy(asc(dataConnections.name))
        : [];

      const [ownedBy] = await db.select({ email: users.email }).from(users).where(eq(users.id, grant.ownerId)).limit(1);
      const [{ guestCount }] = await db.select({ guestCount: count() }).from(appGuests).where(eq(appGuests.appId, app.id));
      const [{ teammateCount }] = await db
        .select({ teammateCount: count() })
        .from(appMembers)
        .innerJoin(orgMembers, and(eq(orgMembers.orgId, grant.orgId), eq(orgMembers.userId, appMembers.userId)))
        .where(eq(appMembers.appId, app.id));
      const badges = await connectionBadges([app.id]);
      // The servers the caller has signed in to themselves, shared with the workspace or not: a teammate's
      // personal sign-in to the same server runs as theirs. One that has expired is theirs to renew.
      const others = badges.filter((badge) => badge.sharing === "personal" && badge.ownerId !== userId);
      const ownSignIns = others.length
        ? await db
            .select({ id: dataConnections.id, config: dataConnections.config, status: dataConnections.status })
            .from(dataConnections)
            .where(and(eq(dataConnections.orgId, grant.orgId), eq(dataConnections.userId, userId)))
            .orderBy(asc(dataConnections.createdAt))
        : [];
      const signedInTo = new Map<string | null, { id: string; expired: boolean }>();
      for (const row of ownSignIns) {
        const server = serverOf(row.config);
        if (server && !signedInTo.has(server)) signedInTo.set(server, { id: row.id, expired: row.status === "invalid" });
      }
      const expiredOwn = (sharing: string, ownerId: string, config: unknown) => {
        if (sharing !== "personal" || ownerId === userId) return null;
        const own = signedInTo.get(serverOf(config));
        return own?.expired ? own.id : null;
      };
      const otherOwners = grant.guest ? [] : [...new Set(badges.map((badge) => badge.ownerId).filter((id) => id !== userId))];
      const ownerEmails = new Map(
        otherOwners.length
          ? (await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, otherOwners))).map((row) => [row.id, row.email])
          : [],
      );
      const { pendingConnectionIds: _ids, ...rest } = app;
      return {
        ...rest,
        orgId: grant.orgId,
        ownerEmail: ownedBy?.email ?? null,
        access: grant.access,
        canChange: grant.canChange,
        guest: grant.guest,
        guestCount,
        teammateCount,
        pendingConnections,
        dashboards: appDashboards,
        connections: badges.map(({ id, name, type, status, config, sharing, ownerId }) => ({
          id,
          name,
          type,
          status,
          sharing,
          mine: ownerId === userId,
          ownerEmail: ownerEmails.get(ownerId) ?? null,
          needsSignIn: sharing === "personal" && ownerId !== userId && !signedInTo.has(serverOf(config)),
          expiredOwnSignIn: expiredOwn(sharing, ownerId, config),
          // Signed in with OAuth: when it's invalid, the fix is signing in again.
          signIn: config && typeof config === "object" && "oauth" in config && config.oauth ? ("oauth" as const) : null,
        })),
      };
    },

    /**
     * Creates an app in the org from the prompt typed on the home page, with
     * the data sources picked in the composer. The caller owns it, and it
     * starts private. Every source must be one they can query in that org.
     */
    create(scope: Scope, input: unknown): Promise<AppResult<{ id: string }>> {
      return guard("create", async () => {
        const role = await roleIn(db, scope.userId, scope.orgId);
        if (!role) return notFound();
        if (!canBuild(role)) return forbidden();
        const parsed = createAppSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const { prompt, connectionIds } = parsed.data;

        const usable = await db
          .select({ id: dataConnections.id, name: dataConnections.name })
          .from(dataConnections)
          .where(and(usableBy(scope), inArray(dataConnections.id, connectionIds)));
        if (usable.length !== connectionIds.length) {
          return fail({
            code: "validation",
            field: "connectionIds",
            message: "One of the chosen data sources no longer exists. Choose again.",
          });
        }

        // Named after its data sources, in the order they were picked; the user renames it.
        const sources = connectionIds.map((id) => usable.find((row) => row.id === id)!.name);
        const taken = await db
          .select({ name: apps.name })
          .from(apps)
          .where(and(eq(apps.orgId, scope.orgId), eq(apps.userId, scope.userId)));
        const [app] = await db
          .insert(apps)
          .values({
            userId: scope.userId,
            orgId: scope.orgId,
            name: appName(sources, taken.map((row) => row.name)),
            pendingPrompt: prompt,
            pendingConnectionIds: connectionIds,
          })
          .returning({ id: apps.id });
        // The sources picked for it are the app's from the start: they show on it, and the agent is told about them.
        await db.insert(appConnections).values(connectionIds.map((connectionId) => ({ appId: app.id, connectionId }))).onConflictDoNothing();
        return ok({ id: app.id });
      });
    },

    rename(userId: string, input: unknown): Promise<AppResult> {
      return guard("rename", async () => {
        const parsed = renameAppSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const grant = await appAccess(db, userId, parsed.data.id);
        if (!grant) return notFound();
        if (!grant.canChange) return forbidden();
        const updated = await db
          .update(apps)
          .set({ name: parsed.data.name, updatedAt: now() })
          .where(eq(apps.id, parsed.data.id))
          .returning({ id: apps.id });
        return updated.length ? ok(undefined) : notFound();
      });
    },

    /**
     * Sets who else in the workspace can open the app: nobody, everyone to
     * view, or everyone to edit. For anyone who can change it, as with a
     * shared document. Its dashboards follow: nothing is shared one by one.
     */
    setTeamAccess(userId: string, input: unknown): Promise<AppResult> {
      return guard("setTeamAccess", async () => {
        const parsed = teamAccessSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const grant = await appAccess(db, userId, parsed.data.id);
        if (!grant) return notFound();
        if (!grant.canChange) return forbidden();
        await db.update(apps).set({ teamAccess: parsed.data.teamAccess, updatedAt: now() }).where(eq(apps.id, parsed.data.id));
        return ok(undefined);
      });
    },

    /**
     * The members of the app's workspace other than its owner, each with what
     * the app gave them by name, for whoever can change it: the people already
     * let in, and the ones who could be. Oldest member first.
     */
    async teammates(userId: string, appId: string): Promise<AppTeammate[]> {
      const grant = await appAccess(db, userId, appId);
      if (!grant?.canChange) return [];
      return db
        .select({ userId: orgMembers.userId, email: users.email, role: orgMembers.role, access: appMembers.access })
        .from(orgMembers)
        .leftJoin(users, eq(users.id, orgMembers.userId))
        .leftJoin(appMembers, and(eq(appMembers.appId, appId), eq(appMembers.userId, orgMembers.userId)))
        .where(and(eq(orgMembers.orgId, grant.orgId), ne(orgMembers.userId, grant.ownerId)))
        .orderBy(asc(orgMembers.createdAt), asc(orgMembers.userId));
    },

    /**
     * Shares the app with one teammate by name, to view or to edit, whatever
     * the rest of the workspace has; or changes what they were given. For
     * anyone who can change the app. Only a member of the app's workspace can
     * be named, and never past their role: a viewer can be let in to view.
     */
    shareWithMember(userId: string, input: unknown): Promise<AppResult> {
      return guard("shareWithMember", async () => {
        const parsed = appMemberSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { id, memberId, access } = parsed.data;
        const grant = await appAccess(db, userId, id);
        if (!grant) return notFound();
        if (!grant.canChange) return forbidden();
        if (memberId === grant.ownerId) return fail({ code: "validation", field: "memberId", message: "The app's owner already has full access." });
        const role = await roleIn(db, memberId, grant.orgId);
        if (!role) return fail({ code: "validation", field: "memberId", message: "This person isn't in the workspace any more." });
        if (access === "edit" && !canBuild(role)) {
          return fail({
            code: "validation",
            field: "memberId",
            message: "They're a viewer in this workspace, so they can only view. An admin can change their role.",
          });
        }
        await db
          .insert(appMembers)
          .values({ appId: id, userId: memberId, access, addedBy: userId })
          .onConflictDoUpdate({ target: [appMembers.appId, appMembers.userId], set: { access } });
        return ok(undefined);
      });
    },

    /** Takes back what the app gave one teammate by name. What the whole workspace has still applies to them. */
    unshareWithMember(userId: string, input: unknown): Promise<AppResult> {
      return guard("unshareWithMember", async () => {
        const parsed = appMemberRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { id, memberId } = parsed.data;
        const grant = await appAccess(db, userId, id);
        if (!grant) return notFound();
        if (!grant.canChange) return forbidden();
        await db.delete(appMembers).where(and(eq(appMembers.appId, id), eq(appMembers.userId, memberId)));
        return ok(undefined);
      });
    },

    /**
     * The apps this user may view only as a guest: listed by email on an app
     * that their place in its workspace, if they have one, doesn't open for
     * them. An app the workspace does open shows with the workspace's apps
     * instead: team access wins, and the two are never merged. Most recently
     * updated first.
     */
    async sharedWithGuest(userId: string): Promise<AppTreeNode[]> {
      const appRows = await db
        .select({
          id: apps.id,
          name: apps.name,
          orgId: apps.orgId,
          ownerId: apps.userId,
          teamAccess: apps.teamAccess,
          role: orgMembers.role,
          own: appMembers.access,
        })
        .from(appGuests)
        .innerJoin(users, eq(users.email, appGuests.email))
        .innerJoin(apps, eq(apps.id, appGuests.appId))
        .leftJoin(orgMembers, and(eq(orgMembers.orgId, apps.orgId), eq(orgMembers.userId, userId)))
        .leftJoin(appMembers, and(eq(appMembers.appId, apps.id), eq(appMembers.userId, userId)))
        .where(eq(users.id, userId))
        .orderBy(desc(apps.updatedAt), desc(apps.id));
      const guestOf = appRows.filter(
        (app) => app.orgId && !(app.role && accessFor({ userId: app.ownerId, teamAccess: app.teamAccess }, userId, app.role, app.own)),
      );
      if (!guestOf.length) return [];
      const dashboardRows = await db
        .select({ appId: dashboards.appId, id: dashboards.id, title: dashboards.title })
        .from(dashboards)
        .where(
          inArray(
            dashboards.appId,
            guestOf.map((app) => app.id),
          ),
        )
        .orderBy(asc(dashboards.position), asc(dashboards.createdAt));
      return guestOf.map(({ id, name, orgId }) => ({
        id,
        orgId: orgId!,
        name,
        mine: false,
        canChange: false,
        dashboards: dashboardRows.filter((dashboard) => dashboard.appId === id).map(({ id: dashboardId, title }) => ({ id: dashboardId, title })),
      }));
    },

    /** The people outside the workspace who may view an app, for whoever can change it. */
    async guests(userId: string, appId: string): Promise<AppGuest[]> {
      const grant = await appAccess(db, userId, appId);
      if (!grant?.canChange) return [];
      return db
        .select({ email: appGuests.email, invitedBy: users.email, invitedAt: appGuests.createdAt })
        .from(appGuests)
        .leftJoin(users, eq(users.id, appGuests.invitedBy))
        .where(eq(appGuests.appId, appId))
        .orderBy(asc(appGuests.createdAt));
    },

    /**
     * Lets someone outside the workspace view the whole app, by email: every
     * dashboard in it, read-only, and nothing else of the workspace. For
     * anyone who can change the app. Refused while the app uses a personal
     * sign-in, which a guest could never query through.
     */
    addGuest(userId: string, input: unknown): Promise<AppResult> {
      return guard("addGuest", async () => {
        const parsed = appGuestSchema.safeParse(input);
        if (!parsed.success) return parsed.error.issues[0]?.path[0] === "id" ? notFound() : fromValidation(parsed.error);
        const { id, email } = parsed.data;
        const grant = await appAccess(db, userId, id);
        if (!grant) return notFound();
        if (!grant.canChange) return forbidden();

        const personal = (await connectionBadges([id])).filter((connection) => connection.sharing === "personal");
        if (personal.length) {
          const names = personal.map((connection) => connection.name).join(", ");
          return fail({
            code: "validation",
            field: "email",
            // A connection can't be taken off an app (a known limitation), so the way out is a new app without it.
            message: `This app uses ${names} with a personal sign-in, which a guest can't query. Share ${names} with the workspace first, or make a new app without it and share that one.`,
          });
        }
        // A teammate is shared with by name, with the access that goes with it: never as a guest.
        const [teammate] = await db
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .innerJoin(users, eq(users.id, orgMembers.userId))
          .where(and(eq(orgMembers.orgId, grant.orgId), eq(users.email, email)))
          .limit(1);
        if (teammate) {
          return fail({ code: "validation", field: "email", message: `${email} is in this workspace. Share with them under its people instead.` });
        }
        const [{ total }] = await db.select({ total: count() }).from(appGuests).where(eq(appGuests.appId, id));
        if (total >= MAX_GUESTS_PER_APP) {
          return fail({ code: "validation", field: "email", message: `An app can have up to ${MAX_GUESTS_PER_APP} guests.` });
        }
        const added = await db.insert(appGuests).values({ appId: id, email, invitedBy: userId }).onConflictDoNothing().returning();
        if (!added.length) return fail({ code: "validation", field: "email", message: `${email} can already view this app.` });
        return ok(undefined);
      });
    },

    /**
     * Takes a guest's access to an app away, at once. For anyone who can
     * change the app, and for the workspace's admins, who oversee every guest
     * even on apps they can't open.
     */
    removeGuest(userId: string, input: unknown): Promise<AppResult> {
      return guard("removeGuest", async () => {
        const parsed = appGuestSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const { id, email } = parsed.data;
        const grant = await appAccess(db, userId, id);
        if (!grant?.canChange) {
          const [app] = await db.select({ orgId: apps.orgId }).from(apps).where(eq(apps.id, id)).limit(1);
          const role = app ? await roleIn(db, userId, app.orgId) : null;
          if (!role) return notFound();
          if (!canManageMembers(role)) return grant ? forbidden() : notFound();
        }
        await db.delete(appGuests).where(and(eq(appGuests.appId, id), eq(appGuests.email, email)));
        return ok(undefined);
      });
    },

    /**
     * Every guest of every app in a workspace, for its admins: who was let
     * in from outside, on which app, by whom. Private apps included, by name
     * only.
     */
    async workspaceGuests(scope: Scope): Promise<WorkspaceGuest[]> {
      const role = await roleIn(db, scope.userId, scope.orgId);
      if (!role || !canManageMembers(role)) return [];
      return db
        .select({ appId: apps.id, appName: apps.name, email: appGuests.email, invitedBy: users.email, invitedAt: appGuests.createdAt })
        .from(appGuests)
        .innerJoin(apps, eq(apps.id, appGuests.appId))
        .leftJoin(users, eq(users.id, appGuests.invitedBy))
        .where(eq(apps.orgId, scope.orgId))
        .orderBy(asc(apps.name), asc(appGuests.createdAt));
    },

    /**
     * Deletes the app and, through the foreign keys, its dashboards, thread
     * mappings and connection usage. Only its owner can. The caller deletes
     * its dashboards in OpenUI Cloud first.
     */
    remove(userId: string, input: unknown): Promise<AppResult> {
      return guard("remove", async () => {
        const parsed = appRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const grant = await appAccess(db, userId, parsed.data.id);
        if (!grant) return notFound();
        if (grant.access !== "owner") return forbidden("Only the app's owner can delete it.");
        const deleted = await db.delete(apps).where(eq(apps.id, parsed.data.id)).returning({ id: apps.id });
        return deleted.length ? ok(undefined) : notFound();
      });
    },

    /**
     * Returns the pending prompt and its data sources, clearing both in one
     * statement, so the chat sends them as the first message exactly once.
     * Only for the owner, who typed it.
     */
    async takePendingPrompt(
      userId: string,
      appId: string,
    ): Promise<{ prompt: string; connectionIds: string[] } | null> {
      if (!appIdSchema.safeParse(appId).success) return null;
      const result = await db.execute<{
        pending_prompt: string | null;
        pending_connection_ids: string[] | null;
      }>(sql`
        UPDATE ${apps} SET pending_prompt = NULL, pending_connection_ids = NULL
        FROM (
          SELECT id, pending_prompt, pending_connection_ids FROM ${apps}
          WHERE id = ${appId} AND user_id = ${userId}
          FOR UPDATE
        ) AS previous
        WHERE ${apps.id} = previous.id
        RETURNING previous.pending_prompt, previous.pending_connection_ids
      `);
      const row = result.rows[0];
      if (!row?.pending_prompt) return null;
      return { prompt: row.pending_prompt, connectionIds: row.pending_connection_ids ?? [] };
    },

    /** Adds a connection the caller can query to an app, so it shows there and the agent uses it. */
    addConnection(userId: string, input: unknown): Promise<AppResult> {
      const parsed = addAppConnectionSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(notFound());
      return service.recordConnectionUse(userId, parsed.data.appId, parsed.data.connectionId);
    },

    /**
     * Records that an app's dashboards use a connection. The caller must be
     * able to change the app and to query the connection, and both must be in
     * the same org. The server calls it when the Build agent queries a
     * connection; the browser never can.
     */
    recordConnectionUse(userId: string, appId: string, connectionId: string): Promise<AppResult> {
      return guard("recordConnectionUse", async () => {
        if (!appIdSchema.safeParse(appId).success || !appIdSchema.safeParse(connectionId).success) {
          return notFound();
        }
        const grant = await appAccess(db, userId, appId);
        if (!grant?.canChange) return notFound();
        const [connection] = await db
          .select({ id: dataConnections.id })
          .from(dataConnections)
          .where(and(eq(dataConnections.id, connectionId), usableBy({ userId, orgId: grant.orgId })))
          .limit(1);
        if (!connection) return notFound();

        await db.insert(appConnections).values({ appId, connectionId }).onConflictDoNothing();
        return ok(undefined);
      });
    },
  };
  return service;
}

export type AppService = ReturnType<typeof createAppService>;

/** Which server a stored connection points at: for telling two sign-ins to the same place apart from two different ones. */
export function serverOf(config: unknown): string | null {
  const url = config && typeof config === "object" && "url" in config ? (config as { url?: unknown }).url : null;
  return typeof url === "string" ? url : null;
}

/**
 * A new app's name: its data sources and a number, "Retail sales: App 2",
 * one more than the highest already used for those sources. No model is
 * involved; the user renames it whenever they like.
 */
export function appName(sources: string[], taken: string[]): string {
  let prefix =
    sources.length === 0
      ? "Untitled"
      : sources.length <= 2
        ? sources.join(" + ")
        : `${sources[0]} + ${sources.length - 1} more`;
  if (prefix.length > 60) prefix = `${prefix.slice(0, 59).trimEnd()}…`;

  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: App (\\d+)$`);
  const highest = Math.max(0, ...taken.map((name) => Number(pattern.exec(name)?.[1] ?? 0)));
  return `${prefix}: App ${highest + 1}`;
}
