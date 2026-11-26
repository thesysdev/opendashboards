import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { ConnectionConfig } from "@/lib/sources/catalog";
import type { SealedSecret } from "@/lib/secrets/types";

/** Matches CONNECTION_TYPES in lib/sources/catalog.ts (a test checks). */
export const connectionTypeEnum = pgEnum("connection_type", ["posthog", "postgres", "mysql", "clickhouse", "bigquery", "ga4", "searchconsole", "googleads", "metaads", "mcp"]);

export const connectionStatusEnum = pgEnum("connection_status", [
  /** The last check passed. */
  "ok",
  /** The credential or settings are wrong: the user has to fix them. */
  "invalid",
  /** We couldn't check (source or secret storage unavailable): retry later. */
  "unavailable",
]);

/** What a member of an org may do. A viewer only opens what's shared with them: no building, no chat. */
export const orgRoleEnum = pgEnum("org_role", ["admin", "editor", "viewer"]);

/** Who else in the org can open an app. Private: only its owner. */
export const appTeamAccessEnum = pgEnum("app_team_access", ["private", "view", "edit"]);

/**
 * How a connection is used, fixed when it's added. org: shared with the
 * workspace, with one credential everyone's queries use (a key, password or
 * service account, or one person's sign-in). personal: requires sign-in, so
 * each member signs in with their own account and queries run as them.
 */
export const connectionSharingEnum = pgEnum("connection_sharing", ["personal", "org"]);

/**
 * Everyone who has signed in: their id from the auth provider and their email,
 * lowercased. Kept so members can be listed and invited by email; identity
 * still comes from the verified session, never from this table.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_email_idx").on(table.email)],
);

/**
 * An org, shown to people as a workspace: what apps and connections belong
 * to, and who can reach them. There is one kind. Someone who signs up without
 * an invite gets one of their own; someone invited joins the one they were
 * invited to. Either can be in several, and can invite others into theirs.
 */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Who created it. */
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: orgRoleEnum("role").notNull(),
    /** Who added them: themselves, for whoever created the org. */
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] }), index("org_members_user_id_idx").on(table.userId)],
);

/**
 * Someone invited by email who hasn't signed in yet. There is no link and no
 * accept step: the row becomes a membership the first time they sign in.
 * People who already have an account are added to `org_members` directly.
 */
export const orgInvites = pgTable(
  "org_invites",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    role: orgRoleEnum("role").notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.email] }), index("org_invites_email_idx").on(table.email)],
);

export const dataConnections = pgTable(
  "data_connections",
  {
    id: uuid("id").primaryKey(),
    /** Who added it. Its secret is sealed for this user, whoever in the org uses it. */
    userId: text("user_id").notNull(),
    /**
     * The org it belongs to. Nullable only so a deployment from before orgs
     * keeps working while this one rolls out: `adoptOrphans` fills it in.
     */
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    sharing: connectionSharingEnum("sharing").notNull().default("org"),
    name: text("name").notNull(),
    type: connectionTypeEnum("type").notNull(),
    /**
     * Where the connection points, per type (PostHog region and project;
     * Postgres host, port, database, user, SSL mode). Validated on every read.
     * Fixed after creation: pointing elsewhere means a new connection.
     */
    config: jsonb("config").$type<ConnectionConfig>().notNull(),
    /**
     * The API key or password, sealed by a SecretBox. Never sent to the browser.
     * Null for a demo dataset, and for a sign-in, whose tokens are in
     * `connection_sign_ins`.
     */
    secret: jsonb("secret").$type<SealedSecret>(),
    /** e.g. "phx_…a1b2", so the UI never needs the credential itself. */
    credentialHint: text("credential_hint").notNull(),
    /**
     * Set when this is an installed demo dataset: its key in config's
     * demoData. Where it points and its (shared, read-only) credential
     * then come from config, never from this row, so it has no secret.
     */
    demoDataset: text("demo_dataset"),
    status: connectionStatusEnum("status").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("data_connections_user_id_idx").on(table.userId),
    index("data_connections_org_id_idx").on(table.orgId),
    // Each demo dataset is installed at most once per org.
    uniqueIndex("data_connections_org_demo_idx").on(table.orgId, table.demoDataset),
    // A demo dataset has no secret of its own, and a key always has one. A sign-in's tokens are in
    // connection_sign_ins; one written by a version from before that has them here until `adoptOrphans`.
    check(
      "data_connections_secret_or_demo",
      sql`CASE WHEN ${table.demoDataset} IS NOT NULL THEN ${table.secret} IS NULL WHEN ${table.config} -> 'oauth' IS NULL THEN ${table.secret} IS NOT NULL ELSE true END`,
    ),
  ],
);

/**
 * Someone's sign-in to a connection: their own OAuth tokens. A connection
 * shared with the workspace has at most one, which everyone's queries use; one
 * that requires sign-in has one per member who signed in, each used only for
 * that member's queries. The secret is sealed for `user_id` and the connection.
 */
export const connectionSignIns = pgTable(
  "connection_sign_ins",
  {
    id: uuid("id").primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => dataConnections.id, { onDelete: "cascade" }),
    /** Who signed in: the account the queries run as. */
    userId: text("user_id").notNull(),
    secret: jsonb("secret").$type<SealedSecret>().notNull(),
    status: connectionStatusEnum("status").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("connection_sign_ins_connection_user_idx").on(table.connectionId, table.userId),
    index("connection_sign_ins_user_id_idx").on(table.userId),
  ],
);

/**
 * An app: a set of dashboards built by chatting, owned by whoever created it
 * and belonging to an org. It can query the connections of its org that the
 * person building can use; `app_connections` records the ones it actually uses.
 */
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Its owner: who created it. */
    userId: text("user_id").notNull(),
    /** The org it belongs to. Nullable for the same reason as a connection's. */
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    /** Who else in the org can open it. Its dashboards follow it: nothing is shared per dashboard. */
    teamAccess: appTeamAccessEnum("team_access").notNull().default("private"),
    name: text("name").notNull(),
    /** The prompt the app was created with, until the chat sends it as the first message. */
    pendingPrompt: text("pending_prompt"),
    /**
     * The data sources picked in the composer for that first message: a hint
     * for the agent, checked to be the user's own. What the app actually uses
     * is still recorded in `app_connections` as dashboards query them.
     */
    pendingConnectionIds: uuid("pending_connection_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("apps_user_id_idx").on(table.userId, table.updatedAt), index("apps_org_id_idx").on(table.orgId, table.updatedAt)],
);

/**
 * Which connections an app uses, recorded by the server when a dashboard
 * queries one. Never chosen by the browser. A connection with rows here
 * can't be deleted.
 */
export const appConnections = pgTable(
  "app_connections",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => dataConnections.id, { onDelete: "restrict" }),
    /**
     * Who added it to the app: picking it, or the Build agent querying it for
     * them. Nullable only for rows a deployment from before this column writes
     * while this one rolls out; the migration filled in the rest.
     */
    createdBy: text("created_by"),
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.connectionId] }),
    index("app_connections_connection_id_idx").on(table.connectionId),
  ],
);

/**
 * People outside the workspace who may view an app, by email. A guest gets
 * the whole app, read-only: every dashboard in it, never one on its own, and
 * nothing else of the workspace. Matched to whoever signs in with that email.
 */
export const appGuests = pgTable(
  "app_guests",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.email] }), index("app_guests_email_idx").on(table.email)],
);

/** What one teammate was given on an app, apart from what the whole workspace has. */
export const appMemberAccessEnum = pgEnum("app_member_access", ["view", "edit"]);

/**
 * A member of the app's workspace it was shared with by name: to view or to
 * edit, whatever the rest of the workspace has. It only counts while they're
 * a member, and their role is still the ceiling (a viewer never edits).
 */
export const appMembers = pgTable(
  "app_members",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    access: appMemberAccessEnum("access").notNull(),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.userId] }), index("app_members_user_id_idx").on(table.userId)],
);

/** A dashboard in an app. Its content and versions live in OpenUI Cloud. */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** OpenUI Cloud's artifact id (art_…). */
    artifactId: text("artifact_id").notNull().unique(),
    /**
     * The dashboard's title and one-line description, drawn above it. OpenDashboards
     * keeps them, not the program in Cloud: the agent sets them when it
     * creates the dashboard, and only people change them afterwards.
     */
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("dashboards_app_id_idx").on(table.appId, table.position)],
);

/**
 * Which app each chat thread belongs to. Threads live in OpenUI Cloud, which
 * has no notion of apps, so the app's thread list is read from here.
 */
export const appThreads = pgTable(
  "app_threads",
  {
    /** OpenUI Cloud's conversation id. */
    threadId: text("thread_id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    // Millisecond precision: the list's paging cursor round-trips through JS Dates.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [index("app_threads_app_id_idx").on(table.appId, table.updatedAt)],
);

/**
 * A sign-in that's been started and not yet finished (an MCP server's OAuth,
 * Google Ads through Composio): kept from sending the browser to the sign-in
 * page until it comes back. The key is a hash of the `state` sent with it, so
 * a database read can't replay one. Single use, short-lived, and tied to the
 * user who started it. The table keeps its first name, from when only MCP
 * servers signed in.
 */
export const pendingSignIns = pgTable(
  "mcp_oauth_sign_ins",
  {
    /** SHA-256 of the state, hex. */
    stateHash: text("state_hash").primaryKey(),
    userId: text("user_id").notNull(),
    /** The org a new connection from this sign-in will belong to. */
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    /** Set when signing in to an existing connection. */
    connectionId: uuid("connection_id").references(() => dataConnections.id, { onDelete: "cascade" }),
    /** How a new connection from this sign-in is used. Ignored for an existing one. */
    sharing: connectionSharingEnum("sharing").notNull().default("personal"),
    name: text("name").notNull(),
    /** The connection's settings once signed in, nothing secret. */
    config: jsonb("config").notNull(),
    /** What finishing needs (an MCP server's PKCE verifier and client registration, say), sealed like any credential. */
    secret: jsonb("secret").$type<SealedSecret>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("mcp_oauth_sign_ins_user_id_idx").on(table.userId)],
);

/**
 * A workspace's Stripe subscription, as Stripe last told us. No row: the free
 * plan. Read and written only by lib/billing, from webhooks and from Stripe
 * itself, never from the browser.
 */
export const orgBilling = pgTable(
  "org_billing",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => orgs.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    /** Null until a subscription starts, and after one ends. */
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** The plan id in config's catalog. Null without a live subscription. */
    plan: text("plan"),
    interval: text("interval").$type<"month" | "year">(),
    /** Stripe's subscription status: active, trialing, past_due, canceled, … */
    status: text("status"),
    /** Seats bought: the subscription's quantity. */
    seats: integer("seats").notNull().default(1),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Who first went to checkout for it. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("org_billing_customer_idx").on(table.stripeCustomerId)],
);

/** Stripe webhook events already handled, so a retried one is handled once. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdBy: text("created_by").notNull().default("stripe"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataConnectionRow = typeof dataConnections.$inferSelect;
export type ConnectionSignInRow = typeof connectionSignIns.$inferSelect;
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];
export type AppTeamAccess = (typeof appTeamAccessEnum.enumValues)[number];
export type AppMemberAccess = (typeof appMemberAccessEnum.enumValues)[number];
export type ConnectionSharing = (typeof connectionSharingEnum.enumValues)[number];
