import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { apps, dataConnections, type ConnectionStatus, type HostKind } from "@/lib/db/schema";
import { logError } from "@/lib/log";
import type { PostHogTarget } from "@/lib/posthog/client";
import type { SecretBox, SecretContext } from "@/lib/secrets";

import {
  fail,
  fromCheckError,
  fromValidation,
  internalError,
  notFound,
  ok,
  statusFor,
  type ConnectionError,
  type Result,
} from "./errors";
import {
  connectionRefSchema,
  createConnectionSchema,
  renameSchema,
  replaceKeySchema,
} from "./schemas";

/** What the UI sees of a connection: never the key or the sealed secret. */
export type ConnectionSummary = {
  id: string;
  name: string;
  hostKind: HostKind;
  projectId: string;
  keyHint: string;
  status: ConnectionStatus;
  lastCheckedAt: Date;
  apps: { id: string; name: string }[];
};

export type ConnectionServiceDeps = {
  db: Database;
  /** A function, so "no secret storage configured" surfaces per call, not at import. */
  secrets: () => SecretBox;
  testConnection: (target: PostHogTarget) => Promise<void>;
  now?: () => Date;
  /** How long a decrypted key stays in memory. */
  keyCacheTtlMs?: number;
};

const DEFAULT_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The data access layer for connections. Every function takes the user id
 * from the caller's verified session and scopes every query to it: another
 * user's connection is indistinguishable from one that doesn't exist.
 */
export function createConnectionService(deps: ConnectionServiceDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const keyCache = createKeyCache(deps.keyCacheTtlMs ?? DEFAULT_KEY_CACHE_TTL_MS, now);

  const context = (userId: string, connectionId: string): SecretContext => ({
    purpose: "posthog-api-key",
    userId,
    connectionId,
  });

  async function findOwned(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(dataConnections)
      .where(and(eq(dataConnections.id, id), eq(dataConnections.userId, userId)))
      .limit(1);
    return row;
  }

  async function appsUsing(userId: string, connectionId: string) {
    return db
      .select({ id: apps.id, name: apps.name })
      .from(apps)
      .where(and(eq(apps.connectionId, connectionId), eq(apps.userId, userId)))
      .orderBy(asc(apps.name));
  }

  /** Runs `fn`, turning anything unexpected into a logged internal error. */
  async function guard<T>(operation: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await fn();
    } catch (error) {
      logError(`connections.${operation}`, error);
      return internalError();
    }
  }

  return {
    async list(userId: string): Promise<ConnectionSummary[]> {
      const rows = await db
        .select({
          id: dataConnections.id,
          name: dataConnections.name,
          hostKind: dataConnections.hostKind,
          projectId: dataConnections.projectId,
          keyHint: dataConnections.keyHint,
          status: dataConnections.status,
          lastCheckedAt: dataConnections.lastCheckedAt,
        })
        .from(dataConnections)
        .where(eq(dataConnections.userId, userId))
        .orderBy(asc(dataConnections.createdAt));

      const appRows = await db
        .select({ id: apps.id, name: apps.name, connectionId: apps.connectionId })
        .from(apps)
        .where(eq(apps.userId, userId))
        .orderBy(asc(apps.name));

      return rows.map((row) => ({
        ...row,
        apps: appRows
          .filter((app) => app.connectionId === row.id)
          .map(({ id, name }) => ({ id, name })),
      }));
    },

    /** Tests the key against PostHog and saves the connection only if it works. */
    create(userId: string, input: unknown): Promise<Result<{ id: string }>> {
      return guard("create", async () => {
        const parsed = createConnectionSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const { name, hostKind, projectId, apiKey } = parsed.data;

        const id = randomUUID();
        try {
          // Sealed first: no point testing a key we can't store.
          const secret = await deps.secrets().seal(apiKey, context(userId, id));
          await deps.testConnection({ hostKind, projectId, apiKey });

          await db.insert(dataConnections).values({
            id,
            userId,
            name,
            type: "posthog",
            hostKind,
            projectId,
            secret,
            keyHint: keyHint(apiKey),
            status: "ok",
            lastCheckedAt: now(),
          });
        } catch (error) {
          const known = fromCheckError(error);
          if (known) return fail(known);
          throw error;
        }
        return ok({ id });
      });
    },

    /** Checks a saved connection again and records the outcome. */
    retest(userId: string, input: unknown): Promise<Result<{ status: ConnectionStatus }>> {
      return guard("retest", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();

        let failure: ConnectionError | null = null;
        try {
          const apiKey = await keyCache.get(row.id, () =>
            deps.secrets().open(row.secret, context(userId, row.id)),
          );
          await deps.testConnection({ hostKind: row.hostKind, projectId: row.projectId, apiKey });
        } catch (error) {
          failure = fromCheckError(error);
          if (!failure) throw error;
          keyCache.delete(row.id);
        }

        const status = failure ? statusFor(failure.code) : "ok";
        await db
          .update(dataConnections)
          .set({ status, lastCheckedAt: now(), updatedAt: now() })
          .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));

        return failure ? fail(failure) : ok({ status });
      });
    },

    /** Swaps the key. Host and project stay fixed. */
    replaceKey(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("replaceKey", async () => {
        const parsed = replaceKeySchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();
        const { apiKey } = parsed.data;

        try {
          const secret = await deps.secrets().seal(apiKey, context(userId, row.id));
          await deps.testConnection({ hostKind: row.hostKind, projectId: row.projectId, apiKey });
          await db
            .update(dataConnections)
            .set({
              secret,
              keyHint: keyHint(apiKey),
              status: "ok",
              lastCheckedAt: now(),
              updatedAt: now(),
            })
            .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));
        } catch (error) {
          const known = fromCheckError(error);
          if (known) return fail(known);
          throw error;
        } finally {
          keyCache.delete(row.id);
        }
        return ok(undefined);
      });
    },

    rename(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("rename", async () => {
        const parsed = renameSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const updated = await db
          .update(dataConnections)
          .set({ name: parsed.data.name, updatedAt: now() })
          .where(
            and(eq(dataConnections.id, parsed.data.id), eq(dataConnections.userId, userId)),
          )
          .returning({ id: dataConnections.id });
        return updated.length ? ok(undefined) : notFound();
      });
    },

    /** Deletes a connection no app uses. */
    remove(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("remove", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();

        const inUse = (users: { id: string; name: string }[]) =>
          fail({
            code: "in_use",
            message: "Apps use this connection. Remove it from them before deleting it.",
            apps: users,
          });

        const users = await appsUsing(userId, row.id);
        if (users.length) return inUse(users);

        try {
          await db
            .delete(dataConnections)
            .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));
        } catch (error) {
          // An app was added between the check and the delete: the foreign key caught it.
          if (isForeignKeyViolation(error)) return inUse(await appsUsing(userId, row.id));
          throw error;
        }
        keyCache.delete(row.id);
        return ok(undefined);
      });
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

/** `phx_…a1b2`: enough to tell keys apart, useless to anyone who reads it. */
export function keyHint(apiKey: string): string {
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

/** Decrypted keys, kept briefly so a busy dashboard doesn't decrypt per query. */
function createKeyCache(ttlMs: number, now: () => Date) {
  const entries = new Map<string, { key: string; expiresAt: number }>();
  return {
    async get(id: string, load: () => Promise<string>): Promise<string> {
      const hit = entries.get(id);
      if (hit && hit.expiresAt > now().getTime()) return hit.key;
      const key = await load();
      entries.set(id, { key, expiresAt: now().getTime() + ttlMs });
      return key;
    },
    delete(id: string) {
      entries.delete(id);
    },
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  // Drizzle wraps driver errors; the Postgres code may sit on the cause.
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23503") return true;
  }
  return false;
}
