import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import {
  appConnections,
  appGuests,
  appMembers,
  apps,
  connectionSignIns,
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
import { track } from "@/lib/analytics";
import { logError } from "@/lib/log";
import { accessFor, appAccess, appFacts, appsOpenTo, asApp, roleIn, workspaceFacts, type AppAccess, type Scope } from "@/lib/orgs/access";
import { can, decide, refusal, type AppFacts, type ConnectionFacts, type ConnectionKind } from "@/lib/orgs/policy";
import { connectionKind, isSignIn } from "@/lib/connections/kind";
import { OPEN_GATE, type Gate } from "@/lib/entitlements";

import { fail, fromValidation, internalError, notFound, ok, type AppResult } from "./errors";
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
  /** Whether the caller may change it (the policy's app.update). False when they can only view it. */
  canChange: boolean;
  /** What the policy decides on, for the sidebar to ask `can`. */
  facts: AppFacts;
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
  /** Whether the caller may change it (the policy's app.update). Never true for a viewer. */
  canChange: boolean;
  /** What the policy decides on, for pages to ask `can`. */
  facts: AppFacts;
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
    /** For a sign-in, that of the sign-in it runs with for the caller (none signed in reads as invalid). */
    status: ConnectionStatus;
    signIn: "oauth" | null;
    sharing: ConnectionSharing;
    kind: ConnectionKind;
    /**
     * For a sign-in, the one it runs with for the caller: a shared one's, or
     * their own of one that requires sign-in. Null for a key.
     */
    signInStatus: "signedIn" | "expired" | "none" | null;
    /** Whether that sign-in is the caller's own. */
    signedInByMe: boolean;
    /**
     * Whom a shared sign-in runs as, by email, when it isn't the caller: who
     * to ask when it expires. Null for a guest, who isn't told who is in the
     * workspace.
     */
    signedInAs: string | null;
    /** Whether the caller may sign in to it (the policy's connection.signIn). */
    canSignIn: boolean;
  })[];
};

/**
 * The data access layer for apps. An app belongs to an org and has an owner.
 * Who may see or change it is decided by lib/orgs/access, from the database:
 * an app the caller can't open looks exactly like a missing one.
 *
 * Timestamps come from the database's clock, as inserts' defaults do: the one
 * clock every server shares, so "most recently updated first" holds.
 */
export function createAppService({ db, now = () => new Date(), gate = OPEN_GATE }: { db: Database; now?: () => Date; gate?: Gate }) {
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

  /** The connections of an org: every member may build on any of them (one that requires sign-in, once signed in). */
  const usableBy = ({ orgId }: Scope) => eq(dataConnections.orgId, orgId);

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
        demoDataset: dataConnections.demoDataset,
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

      return appRows.map(({ userId: ownerId, teamAccess, ...app }) => {
        const facts = asApp(accessFor({ userId: ownerId, teamAccess }, scope.userId, role, own.get(app.id) ?? null) ?? "view", role);
        return {
        ...app,
        orgId: scope.orgId,
        mine: ownerId === scope.userId,
        canChange: can("app", "update", facts),
        facts,
        dashboards: dashboardRows
          .filter((dashboard) => dashboard.appId === app.id)
          .map(({ id, title }) => ({ id, title })),
        };
      });
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
      // The sign-ins these connections run with for the caller: a shared one's, whoever holds it, and their own.
      const signInRows = badges.length
        ? await db
            .select({ connectionId: connectionSignIns.connectionId, userId: connectionSignIns.userId, status: connectionSignIns.status, email: users.email })
            .from(connectionSignIns)
            .leftJoin(users, eq(users.id, connectionSignIns.userId))
            .where(
              inArray(
                connectionSignIns.connectionId,
                badges.map((badge) => badge.id),
              ),
            )
            .orderBy(asc(connectionSignIns.createdAt))
        : [];
      const { pendingConnectionIds: _ids, ...rest } = app;
      const describe = (badge: (typeof badges)[number]) => {
        const kind = connectionKind(badge);
        const signIn =
          kind === "key"
            ? null
            : (signInRows.find((row) => row.connectionId === badge.id && (kind === "signInShared" || row.userId === userId)) ?? null);
        const facts: ConnectionFacts = {
          kind: "connection",
          role: grant.facts.role,
          own: badge.ownerId === userId,
          signedIn: signIn?.userId === userId,
          empty: kind === "signInShared" && !signIn,
          connection: kind,
        };
        return {
          kind,
          status: kind === "key" ? badge.status : (signIn?.status ?? ("invalid" as const)),
          signInStatus: kind === "key" ? null : !signIn ? ("none" as const) : signIn.status === "invalid" ? ("expired" as const) : ("signedIn" as const),
          signedInByMe: facts.signedIn,
          signedInAs: grant.guest || facts.signedIn ? null : (signIn?.email ?? null),
          canSignIn: can("connection", "signIn", facts),
        };
      };
      return {
        ...rest,
        orgId: grant.orgId,
        ownerEmail: ownedBy?.email ?? null,
        access: grant.access,
        canChange: grant.canChange,
        facts: grant.facts,
        guest: grant.guest,
        guestCount,
        teammateCount,
        pendingConnections,
        dashboards: appDashboards,
        connections: badges.map((badge) => ({
          id: badge.id,
          name: badge.name,
          type: badge.type,
          sharing: badge.sharing,
          ...describe(badge),
          // Signed in with OAuth: when it's invalid, the fix is signing in again.
          signIn: isSignIn(badge.config) ? ("oauth" as const) : null,
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
        const creating = decide("app", "create", await workspaceFacts(db, scope.userId, scope.orgId));
        if (!creating.allowed) return refusal(creating);
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
        return db.transaction(async (tx) => {
          // Checked in the same transaction as the insert, so two can't pass at the plan's limit.
          const refused = await gate(tx, scope.orgId, "createApp");
          if (refused) return fail(refused);
          const [app] = await tx
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
          await tx
            .insert(appConnections)
            .values(connectionIds.map((connectionId) => ({ appId: app.id, connectionId, createdBy: scope.userId })))
            .onConflictDoNothing();
          return ok({ id: app.id });
        });
      });
    },

    rename(userId: string, input: unknown): Promise<AppResult> {
      return guard("rename", async () => {
        const parsed = renameAppSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const app = await appFacts(db, userId, parsed.data.id);
        const renaming = decide("app", "update", app?.facts ?? null);
        if (!renaming.allowed) return refusal(renaming);
        const refused = await gate(db, app!.orgId, "renameApp");
        if (refused) return fail(refused);
        const updated = await db
          .update(apps)
          .set({ name: parsed.data.name, updatedAt: sql`now()` })
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
        const sharing = decide("appSharing", "update", (await appFacts(db, userId, parsed.data.id))?.facts ?? null);
        if (!sharing.allowed) return refusal(sharing);
        await db.update(apps).set({ teamAccess: parsed.data.teamAccess, updatedAt: sql`now()` }).where(eq(apps.id, parsed.data.id));
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
      if (!grant || !can("appSharing", "view", grant.facts)) return [];
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
        const grant = await appFacts(db, userId, id);
        if (!grant) return notFound();
        const sharing = decide("appSharing", "create", grant.facts);
        if (!sharing.allowed) return refusal(sharing);
        if (memberId === grant.ownerId) return fail({ code: "validation", field: "memberId", message: "The app's owner already has full access." });
        const role = await roleIn(db, memberId, grant.orgId);
        if (!role) return fail({ code: "validation", field: "memberId", message: "This person isn't in the workspace any more." });
        // Their role is the ceiling: a viewer in the workspace can only be let in to view.
        if (access === "edit" && role === "viewer") {
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
        const unsharing = decide("appSharing", "delete", (await appFacts(db, userId, id))?.facts ?? null);
        if (!unsharing.allowed) return refusal(unsharing);
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
      return guestOf.map(({ id, name, orgId, role }) => ({
        id,
        orgId: orgId!,
        name,
        mine: false,
        canChange: false,
        facts: asApp("view", role, true),
        dashboards: dashboardRows.filter((dashboard) => dashboard.appId === id).map(({ id: dashboardId, title }) => ({ id: dashboardId, title })),
      }));
    },

    /** The people outside the workspace who may view an app, for whoever can change it. */
    async guests(userId: string, appId: string): Promise<AppGuest[]> {
      const grant = await appAccess(db, userId, appId);
      if (!grant || !can("guest", "view", grant.facts)) return [];
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
        const grant = await appFacts(db, userId, id);
        if (!grant) return notFound();
        const adding = decide("guest", "create", grant.facts);
        if (!adding.allowed) return refusal(adding);

        const eachSignsIn = (await connectionBadges([id])).filter((connection) => connectionKind(connection) === "signInEach");
        if (eachSignsIn.length) {
          const names = eachSignsIn.map((connection) => connection.name).join(", ");
          return fail({
            code: "validation",
            field: "email",
            // A connection can't be taken off an app (a known limitation), so the way out is a new app without it.
            message: `This app uses ${names}, which everyone signs in to with their own account, so a guest could never see its data. Make a new app without it and share that one.`,
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
        const removing = decide("guest", "delete", (await appFacts(db, userId, id))?.facts ?? null);
        if (!removing.allowed) return refusal(removing);
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
      if (!can("guest", "viewAll", await workspaceFacts(db, scope.userId, scope.orgId))) return [];
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
        const deleting = decide("app", "delete", (await appFacts(db, userId, parsed.data.id))?.facts ?? null);
        if (!deleting.allowed) return refusal(deleting);
        const [{ dashboardCount }] = await db.select({ dashboardCount: count() }).from(dashboards).where(eq(dashboards.appId, parsed.data.id));
        const [deleted] = await db.delete(apps).where(eq(apps.id, parsed.data.id)).returning({ orgId: apps.orgId, createdAt: apps.createdAt });
        if (!deleted) return notFound();
        track(
          userId,
          "app_deleted",
          { app_id: parsed.data.id, dashboards: dashboardCount, age_days: Math.floor((Date.now() - deleted.createdAt.getTime()) / 86_400_000) },
          deleted.orgId,
        );
        return ok(undefined);
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
    async addConnection(userId: string, input: unknown): Promise<AppResult> {
      const parsed = addAppConnectionSchema.safeParse(input);
      if (!parsed.success) return notFound();
      const app = await appFacts(db, userId, parsed.data.appId);
      if (!app) return notFound();
      const refused = await gate(db, app.orgId, "addAppConnection");
      if (refused) return fail(refused);
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
        const app = await appFacts(db, userId, appId);
        if (!app) return notFound();
        const adding = decide("app", "addConnection", app.facts);
        if (!adding.allowed) return refusal(adding);
        const grant = app;
        const [connection] = await db
          .select({ id: dataConnections.id, name: dataConnections.name, config: dataConnections.config, sharing: dataConnections.sharing, demoDataset: dataConnections.demoDataset })
          .from(dataConnections)
          .where(and(eq(dataConnections.id, connectionId), usableBy({ userId, orgId: grant.orgId })))
          .limit(1);
        if (!connection) return notFound();

        // The reverse of addGuest's rule: guests could never see data that needs each person's own sign-in.
        if (connectionKind(connection) === "signInEach") {
          const [{ guests }] = await db.select({ guests: count() }).from(appGuests).where(eq(appGuests.appId, appId));
          const [already] = await db
            .select({ id: appConnections.connectionId })
            .from(appConnections)
            .where(and(eq(appConnections.appId, appId), eq(appConnections.connectionId, connectionId)))
            .limit(1);
          if (guests > 0 && !already) {
            return fail({
              code: "guests_cant_sign_in",
              message: `${connection.name} needs everyone to sign in with their own account, and this app has guests, who never can. Use a connection shared with the workspace, or make a new app for it.`,
            });
          }
        }

        await db.insert(appConnections).values({ appId, connectionId, createdBy: userId }).onConflictDoNothing();
        return ok(undefined);
      });
    },
  };
  return service;
}

export type AppService = ReturnType<typeof createAppService>;

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
