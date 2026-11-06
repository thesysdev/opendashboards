import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { appConnections, apps, dataConnections, type ConnectionStatus } from "@/lib/db/schema";
import { logError } from "@/lib/log";
import type { SecretBox, SecretContext } from "@/lib/secrets";
import {
  CONNECTION_TYPES,
  connectionConfigSchema,
  describeConnection,
  type ConnectionConfig,
  type ConnectionType,
} from "@/lib/sources/catalog";
import type { ConnectionSource, ConnectionWarning, OpenConnection } from "@/lib/sources/types";

import {
  fail,
  fromCheckError,
  fromValidation,
  internalError,
  notFound,
  ok,
  type ConnectionError,
  type Result,
} from "./errors";
import {
  connectionRefSchema,
  createEnvelopeSchema,
  renameSchema,
  replaceCredentialSchema,
} from "./schemas";

export type { ConnectionWarning };

/** What the UI sees of a connection: never the credential or the sealed secret. */
export type ConnectionSummary = {
  id: string;
  name: string;
  type: ConnectionType;
  /** "PostHog · US Cloud", "Postgres". */
  source: string;
  /** "PostHog US", "Postgres": for pickers. */
  shortSource: string;
  /** "Project 12345", "analyst@db.example.com:5432/app". */
  detail: string;
  /** Source tile letters. */
  tile: string;
  credentialHint: string;
  status: ConnectionStatus;
  lastCheckedAt: Date;
  apps: { id: string; name: string }[];
};

export type ConnectionServiceDeps = {
  db: Database;
  /** A function, so "no secret storage configured" surfaces per call, not at import. */
  secrets: () => SecretBox;
  /** The source for a type: lib/sources in the app, stubs in tests. */
  sources: (type: ConnectionType) => ConnectionSource;
  now?: () => Date;
  /** How long a decrypted credential stays in memory. */
  keyCacheTtlMs?: number;
};

const DEFAULT_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The data access layer for connections. Every function takes the user id
 * from the caller's verified session and scopes every query to it: another
 * user's connection is indistinguishable from one that doesn't exist. Anything
 * specific to a source type comes from that source (lib/sources).
 */
export function createConnectionService(deps: ConnectionServiceDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const keyCache = createKeyCache(deps.keyCacheTtlMs ?? DEFAULT_KEY_CACHE_TTL_MS, now);

  const context = (type: ConnectionType, userId: string, connectionId: string): SecretContext => ({
    purpose: deps.sources(type).credential.purpose,
    userId,
    connectionId,
  });

  /** The source's own check, with the settings stripped of their type tag. */
  function check(config: ConnectionConfig, credential: string): Promise<ConnectionWarning[]> {
    const { type, ...settings } = config;
    return deps.sources(type).test(settings, credential);
  }

  /** A stored row's config, validated: a row that doesn't parse is a bug, not user input. */
  function configOf(row: { config: unknown }): ConnectionConfig {
    return connectionConfigSchema.parse(row.config);
  }

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
      .from(appConnections)
      .innerJoin(apps, eq(apps.id, appConnections.appId))
      .where(and(eq(appConnections.connectionId, connectionId), eq(apps.userId, userId)))
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

  /** A failed check as a result, or rethrown when it's not a known failure. */
  function checkFailure(error: unknown): Result<never> {
    const known = fromCheckError(error);
    if (known) return fail(known.error);
    throw error;
  }

  return {
    async list(userId: string): Promise<ConnectionSummary[]> {
      const rows = await db
        .select({
          id: dataConnections.id,
          name: dataConnections.name,
          type: dataConnections.type,
          config: dataConnections.config,
          credentialHint: dataConnections.credentialHint,
          status: dataConnections.status,
          lastCheckedAt: dataConnections.lastCheckedAt,
        })
        .from(dataConnections)
        .where(eq(dataConnections.userId, userId))
        .orderBy(asc(dataConnections.createdAt));

      const appRows = await db
        .select({ id: apps.id, name: apps.name, connectionId: appConnections.connectionId })
        .from(appConnections)
        .innerJoin(apps, eq(apps.id, appConnections.appId))
        .where(eq(apps.userId, userId))
        .orderBy(asc(apps.name));

      return rows.map(({ config, ...row }) => ({
        ...row,
        ...describeConnection(configOf({ config })),
        apps: appRows.filter((app) => app.connectionId === row.id).map(({ id, name }) => ({ id, name })),
      }));
    },

    /** Tests the credential against the source and saves the connection only if it works. */
    create(userId: string, input: unknown): Promise<Result<{ id: string; warnings: ConnectionWarning[] }>> {
      return guard("create", async () => {
        const envelope = createEnvelopeSchema.safeParse(input);
        if (!envelope.success) return fromValidation(envelope.error);
        const type = envelope.data.type as ConnectionType;
        if (!(CONNECTION_TYPES as readonly string[]).includes(type)) {
          return fail({ code: "validation", message: "Unknown source type." });
        }
        const source = deps.sources(type);
        const { name, type: _type, [source.credential.field]: rawCredential, ...rawConfig } = envelope.data;

        const settings = source.configSchema.safeParse(rawConfig);
        if (!settings.success) return fromValidation(settings.error);
        const credential = source.credential.schema.safeParse(rawCredential);
        if (!credential.success) return fromValidation(credential.error, () => source.credential.field);

        const config = { type, ...settings.data } as ConnectionConfig;
        const id = randomUUID();
        let warnings: ConnectionWarning[];
        try {
          // Sealed first: no point testing a credential we can't store.
          const secret = await deps.secrets().seal(credential.data, context(type, userId, id));
          warnings = await check(config, credential.data);
          await db.insert(dataConnections).values({
            id,
            userId,
            name,
            type,
            config,
            secret,
            credentialHint: source.credential.hint(credential.data),
            status: "ok",
            lastCheckedAt: now(),
          });
        } catch (error) {
          return checkFailure(error);
        }
        return ok({ id, warnings });
      });
    },

    /** Checks a saved connection again and records the outcome. */
    retest(userId: string, input: unknown): Promise<Result<{ status: ConnectionStatus }>> {
      return guard("retest", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();

        let failure: { error: ConnectionError; status: Exclude<ConnectionStatus, "ok"> } | null = null;
        try {
          const config = configOf(row);
          const credential = await keyCache.get(row.id, () =>
            deps.secrets().open(row.secret, context(config.type, userId, row.id)),
          );
          await check(config, credential);
        } catch (error) {
          failure = fromCheckError(error);
          if (!failure) throw error;
          keyCache.delete(row.id);
        }

        const status = failure ? failure.status : "ok";
        await db
          .update(dataConnections)
          .set({ status, lastCheckedAt: now(), updatedAt: now() })
          .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));

        return failure ? fail(failure.error) : ok({ status });
      });
    },

    /** Swaps the API key or password. Where the connection points stays fixed. */
    replaceCredential(userId: string, input: unknown): Promise<Result<{ warnings: ConnectionWarning[] }>> {
      return guard("replaceCredential", async () => {
        const parsed = replaceCredentialSchema.safeParse(input);
        if (!parsed.success) {
          return parsed.error.issues[0]?.path[0] === "id" ? notFound() : fromValidation(parsed.error);
        }
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();

        const config = configOf(row);
        const source = deps.sources(config.type);
        const credential = source.credential.schema.safeParse(parsed.data.credential);
        if (!credential.success) return fromValidation(credential.error, () => source.credential.field);

        let warnings: ConnectionWarning[];
        try {
          const secret = await deps.secrets().seal(credential.data, context(config.type, userId, row.id));
          warnings = await check(config, credential.data);
          await db
            .update(dataConnections)
            .set({
              secret,
              credentialHint: source.credential.hint(credential.data),
              status: "ok",
              lastCheckedAt: now(),
              updatedAt: now(),
            })
            .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));
        } catch (error) {
          return checkFailure(error);
        } finally {
          keyCache.delete(row.id);
        }
        return ok({ warnings });
      });
    },

    rename(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("rename", async () => {
        const parsed = renameSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);
        const updated = await db
          .update(dataConnections)
          .set({ name: parsed.data.name, updatedAt: now() })
          .where(and(eq(dataConnections.id, parsed.data.id), eq(dataConnections.userId, userId)))
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
            message: "Dashboards in these apps use this connection. Delete those apps first.",
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

    /**
     * A connection opened for a tool: its settings and decrypted credential,
     * only if it belongs to `userId` and is of `type`. Server code only; the
     * credential never leaves the server.
     */
    async open(userId: string, connectionId: string, type: ConnectionType): Promise<OpenConnection<Record<string, unknown>> | null> {
      if (!connectionIdSchema(connectionId)) return null;
      const row = await findOwned(userId, connectionId);
      if (!row || row.type !== type) return null;
      const { type: _type, ...settings } = configOf(row);
      const credential = await keyCache.get(row.id, () => deps.secrets().open(row.secret, context(type, userId, row.id)));
      return { id: row.id, name: row.name, config: settings, credential };
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const connectionIdSchema = (value: string) => UUID.test(value);

/** Decrypted credentials, kept briefly so a busy dashboard doesn't decrypt per query. */
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
