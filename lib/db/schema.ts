import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { SealedSecret } from "@/lib/secrets/types";

export const connectionTypeEnum = pgEnum("connection_type", ["posthog"]);

/** Where a connection points. Chosen from this list when it's added, never typed in. */
export const hostKindEnum = pgEnum("host_kind", ["posthog_us", "posthog_eu"]);

export const connectionStatusEnum = pgEnum("connection_status", [
  /** The last check passed. */
  "ok",
  /** The key or project is wrong: the user has to fix it. */
  "invalid",
  /** We couldn't check (PostHog or secret storage unavailable): retry later. */
  "unavailable",
]);

export const dataConnections = pgTable(
  "data_connections",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: connectionTypeEnum("type").notNull(),
    /** Fixed after creation: a different host means a new connection. */
    hostKind: hostKindEnum("host_kind").notNull(),
    projectId: text("project_id").notNull(),
    /** The API key, sealed by a SecretBox. Never sent to the browser. */
    secret: jsonb("secret").$type<SealedSecret>().notNull(),
    /** e.g. "phx_…a1b2", so the UI never needs the key itself. */
    keyHint: text("key_hint").notNull(),
    status: connectionStatusEnum("status").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("data_connections_user_id_idx").on(table.userId)],
);

/** Minimal for now: enough for a connection's "used by" list and delete check. */
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => dataConnections.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("apps_user_id_idx").on(table.userId),
    index("apps_connection_id_idx").on(table.connectionId),
  ],
);

export type DataConnectionRow = typeof dataConnections.$inferSelect;
export type HostKind = (typeof hostKindEnum.enumValues)[number];
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];
