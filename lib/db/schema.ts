import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { ConnectionConfig } from "@/lib/sources/catalog";
import type { SealedSecret } from "@/lib/secrets/types";

/** Matches CONNECTION_TYPES in lib/sources/catalog.ts (a test checks). */
export const connectionTypeEnum = pgEnum("connection_type", ["posthog", "postgres"]);

export const connectionStatusEnum = pgEnum("connection_status", [
  /** The last check passed. */
  "ok",
  /** The credential or settings are wrong: the user has to fix them. */
  "invalid",
  /** We couldn't check (source or secret storage unavailable): retry later. */
  "unavailable",
]);

export const dataConnections = pgTable(
  "data_connections",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: connectionTypeEnum("type").notNull(),
    /**
     * Where the connection points, per type (PostHog region and project;
     * Postgres host, port, database, user, SSL mode). Validated on every read.
     * Fixed after creation: pointing elsewhere means a new connection.
     */
    config: jsonb("config").$type<ConnectionConfig>().notNull(),
    /** The API key or password, sealed by a SecretBox. Never sent to the browser. */
    secret: jsonb("secret").$type<SealedSecret>().notNull(),
    /** e.g. "phx_…a1b2", so the UI never needs the credential itself. */
    credentialHint: text("credential_hint").notNull(),
    status: connectionStatusEnum("status").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("data_connections_user_id_idx").on(table.userId)],
);

/**
 * An app: a set of dashboards built by chatting. It can query any of its
 * owner's connections; `app_connections` records the ones it actually uses.
 */
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
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
  (table) => [index("apps_user_id_idx").on(table.userId, table.updatedAt)],
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
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.connectionId] }),
    index("app_connections_connection_id_idx").on(table.connectionId),
  ],
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
    title: text("title").notNull(),
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

export type DataConnectionRow = typeof dataConnections.$inferSelect;
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];

/** Chat turns per UTC day, per user, plus one row (`user_id` "*") for the total. */
export const chatUsage = pgTable(
  "chat_usage",
  {
    day: date("day").notNull(),
    userId: text("user_id").notNull(),
    turns: integer("turns").notNull().default(0),
    /** Set while a turn runs, so a user runs one at a time. Expires if the turn crashes. */
    activeUntil: timestamp("active_until", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.day, table.userId] })],
);
