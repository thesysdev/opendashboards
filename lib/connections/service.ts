import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { appConnections, apps, dataConnections, type ConnectionStatus } from "@/lib/db/schema";
import { logError } from "@/lib/log";
import type { PostgresCheck, PostgresTarget } from "@/lib/postgres/client";
import { passwordSchema } from "@/lib/postgres/config";
import type { PostHogTarget } from "@/lib/posthog/client";
import type { SecretBox, SecretContext } from "@/lib/secrets";

import {
  connectionConfigSchema,
  describeConnection,
  type ConnectionConfig,
  type ConnectionType,
} from "./config";

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
  apiKeySchema,
  connectionRefSchema,
  createConnectionSchema,
  renameSchema,
  replaceCredentialSchema,
  type CreateConnectionInput,
} from "./schemas";

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
  testConnection: (target: PostHogTarget) => Promise<void>;
  testPostgres: (target: PostgresTarget) => Promise<PostgresCheck>;
  now?: () => Date;
  /** How long a decrypted credential stays in memory. */
  keyCacheTtlMs?: number;
};

/** Things a check found that don't stop the connection from working. */
export type ConnectionWarning = "can_write";

/** Shown in place of a password: no characters of it, ever. */
const PASSWORD_HINT = "password ••••";

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

  const context = (type: ConnectionType, userId: string, connectionId: string): SecretContext => ({
    purpose: type === "postgres" ? "postgres-password" : "posthog-api-key",
    userId,
    connectionId,
  });

  /** Runs the source's own check with this credential. */
  async function check(config: ConnectionConfig, credential: string): Promise<ConnectionWarning[]> {
    switch (config.type) {
      case "posthog":
        await deps.testConnection({ hostKind: config.hostKind, projectId: config.projectId, apiKey: credential });
        return [];
      case "postgres": {
        const { type: _type, ...target } = config;
        const result = await deps.testPostgres({ ...target, password: credential });
        return result.canWrite ? ["can_write"] : [];
      }
    }
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

      return rows.map(({ config, ...row }) => {
        const { source, shortSource, detail, tile } = describeConnection(configOf({ config }));
        return {
          ...row,
          source,
          shortSource,
          detail,
          tile,
          apps: appRows
            .filter((app) => app.connectionId === row.id)
            .map(({ id, name }) => ({ id, name })),
        };
      });
    },

    /** Tests the credential against the source and saves the connection only if it works. */
    create(userId: string, input: unknown): Promise<Result<{ id: string; warnings: ConnectionWarning[] }>> {
      return guard("create", async () => {
        const parsed = createConnectionSchema.safeParse(input);
        if (!parsed.success) return fromValidation(parsed.error);

        const { name, config, credential } = splitCreateInput(parsed.data);
        const id = randomUUID();
        let warnings: ConnectionWarning[];
        try {
          // Sealed first: no point testing a credential we can't store.
          const secret = await deps.secrets().seal(credential, context(config.type, userId, id));
          warnings = await check(config, credential);

          await db.insert(dataConnections).values({
            id,
            userId,
            name,
            type: config.type,
            config,
            secret,
            credentialHint: credentialHint(config.type, credential),
            status: "ok",
            lastCheckedAt: now(),
          });
        } catch (error) {
          const known = fromCheckError(error);
          if (known) return fail(known);
          throw error;
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

        let failure: ConnectionError | null = null;
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

        const status = failure ? statusFor(failure.code) : "ok";
        await db
          .update(dataConnections)
          .set({ status, lastCheckedAt: now(), updatedAt: now() })
          .where(and(eq(dataConnections.id, row.id), eq(dataConnections.userId, userId)));

        return failure ? fail(failure) : ok({ status });
      });
    },

    /** Swaps the API key or password. Where the connection points stays fixed. */
    replaceCredential(userId: string, input: unknown): Promise<Result<{ warnings: ConnectionWarning[] }>> {
      return guard("replaceCredential", async () => {
        const parsed = replaceCredentialSchema.safeParse(input);
        if (!parsed.success) return parsed.error.issues[0]?.path[0] === "id" ? notFound() : fromValidation(parsed.error);
        const row = await findOwned(userId, parsed.data.id);
        if (!row) return notFound();

        const config = configOf(row);
        const field = config.type === "postgres" ? "password" : "apiKey";
        const credentialCheck = (config.type === "postgres" ? passwordSchema : apiKeySchema).safeParse(
          parsed.data.credential,
        );
        if (!credentialCheck.success) return fromValidation(credentialCheck.error, () => field);
        const credential = credentialCheck.data;

        let warnings: ConnectionWarning[];
        try {
          const secret = await deps.secrets().seal(credential, context(config.type, userId, row.id));
          warnings = await check(config, credential);
          await db
            .update(dataConnections)
            .set({
              secret,
              credentialHint: credentialHint(config.type, credential),
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
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

/**
 * What the UI shows instead of the credential. API keys: `phx_…a1b2`, enough
 * to tell keys apart and useless to anyone who reads it. Passwords: nothing
 * of the password at all.
 */
export function credentialHint(type: ConnectionType, credential: string): string {
  if (type === "postgres") return PASSWORD_HINT;
  return `${credential.slice(0, 4)}…${credential.slice(-4)}`;
}

/** Splits validated create input into name, stored config and credential. */
function splitCreateInput(input: CreateConnectionInput): { name: string; config: ConnectionConfig; credential: string } {
  if (input.type === "posthog") {
    const { name, apiKey, ...config } = input;
    return { name, config, credential: apiKey };
  }
  const { name, password, ...config } = input;
  return { name, config, credential: password };
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
