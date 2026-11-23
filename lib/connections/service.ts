import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import type { DemoDataset } from "@/config";
import type { Database } from "@/lib/db";
import {
  appConnections,
  apps,
  dataConnections,
  mcpOAuthSignIns,
  users,
  type ConnectionSharing,
  type ConnectionStatus,
  type DataConnectionRow,
  type OrgRole,
} from "@/lib/db/schema";
import { logError, logRejection, logWarning } from "@/lib/log";
import { appAccess, appOpenTo, appsOpenTo, isUuid, roleIn, workspaceFacts, type Scope } from "@/lib/orgs/access";
import { can, decide, refusal, type ConnectionFacts } from "@/lib/orgs/policy";
import { count } from "@/lib/metrics";
import type { SecretBox, SecretContext } from "@/lib/secrets";
import { MAX_SECRET_BYTES, SecretTooLargeError, secretBytes, type SealedSecret } from "@/lib/secrets/types";
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
  demoRefSchema,
  renameSchema,
  replaceCredentialSchema,
  sharingSchema,
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
  /** "oauth" for a connection signed in with OAuth, which can be signed in to again. */
  signIn: "oauth" | null;
  /** Set for an installed demo dataset: which one, and what's in it. */
  demo: { key: string; description: string; summary: string } | null;
  /** org: every member of the org queries with it. personal: only whoever signed in. */
  sharing: ConnectionSharing;
  /** Whether the caller added it (for a sign-in: whether it's theirs). */
  mine: boolean;
  /** Who added it, by email, when it isn't the caller. */
  addedBy: string | null;
  /** Whether the caller may rename, re-key, test or delete it (the policy's connection.update). */
  canManage: boolean;
  /** What the policy decides on, for pages to ask `can`. */
  facts: ConnectionFacts;
};

/** A demo dataset as the Connections and home pages show it. */
export type DemoDatasetSummary = {
  key: string;
  name: string;
  description: string;
  summary: string;
  prompts: string[];
  /** The user's connection to it, when installed. */
  connectionId: string | null;
  /** Apps that use it: it can't be uninstalled while there are any. */
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
  /** How long a started OAuth sign-in waits for its callback. */
  signInTtlMs?: number;
  /** Demo datasets on offer, and the shared read-only password. No password: none on offer. */
  demo?: { datasets: () => DemoDataset[]; password: () => string | undefined };
};

/** How an installed demo dataset reads in lists and pickers. */
function describeDemo(dataset: DemoDataset) {
  return { ...describeConnection({ type: "postgres", ...dataset.postgres }), source: "Demo dataset", shortSource: "Demo", tile: "DM" };
}

/** How each source's credential field reads in a message. */
const CREDENTIAL_NAMES: Record<string, string> = {
  password: "password",
  apiKey: "API key",
  serviceAccountKey: "service account key",
};

const DEFAULT_SIGN_IN_TTL_MS = 10 * 60 * 1000;

const DEFAULT_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The data access layer for connections. A connection belongs to an org. One
 * with a key, password or service account serves every member of the org; a
 * sign-in (OAuth) is its owner's alone until they share it. Editors and admins
 * manage the org's connections; a sign-in is managed only by whoever signed in.
 *
 * Every function takes the user id (and, where it matters, the org) from the
 * caller's verified session and checks membership in the database: a
 * connection the caller can't use is indistinguishable from one that doesn't
 * exist. A secret stays sealed for the user who added the connection
 * (`user_id`), whoever in the org uses it. Anything specific to a source type
 * comes from that source (lib/sources).
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

  /**
   * Refuses a credential too large to encrypt, on its form field, before any
   * secret store sees it. Logged and counted (never the value: only its source
   * and size), so we know if real credentials ever hit the limit.
   */
  function refuseIfTooLarge(type: ConnectionType, credential: string, operation: "create" | "replace"): Result<never> | null {
    const bytes = secretBytes(credential);
    if (bytes <= MAX_SECRET_BYTES) return null;
    const field = deps.sources(type).credential.field;
    logWarning("secrets.too_large", { source: type, field, operation, bytes, limit: MAX_SECRET_BYTES });
    count("opendashboards.secret.too_large", { source: type, operation });
    return fail({
      code: "credential_too_large",
      field,
      message: `This ${CREDENTIAL_NAMES[field] ?? "credential"} is too large to store securely: ${bytes.toLocaleString("en-US")} bytes, and the most OpenDashboards can store is ${MAX_SECRET_BYTES.toLocaleString("en-US")}. Check you pasted only the ${CREDENTIAL_NAMES[field] ?? "credential"}.`,
    });
  }

  /** An empty credential (a server with no password) is recorded as "none": nothing to encrypt. */
  const sealCredential = (credential: string, ctx: SecretContext): Promise<SealedSecret> =>
    credential === "" ? Promise.resolve({ v: 1, provider: "none" }) : deps.secrets().seal(credential, ctx);

  const openCredential = (sealed: SealedSecret | null, ctx: SecretContext): Promise<string> =>
    sealed?.provider === "none" ? Promise.resolve("") : deps.secrets().open(sealed!, ctx);

  /** The source's own check, with the settings stripped of their type tag. */
  function check(config: ConnectionConfig, credential: string): Promise<ConnectionWarning[]> {
    const { type, ...settings } = config;
    return deps.sources(type).test(settings, credential);
  }

  /** The demo datasets on offer: none without the shared password. */
  function demoDatasets(): DemoDataset[] {
    return deps.demo?.password() ? deps.demo.datasets() : [];
  }

  const demoDatasetFor = (key: string | null) => (key ? demoDatasets().find((dataset) => dataset.key === key) : undefined);

  const demoReadOnly = (): Result<never> =>
    fail({ code: "demo_dataset", message: "Demo datasets can't be changed. Uninstall it from Data Connections instead." });

  /** A stored row's config, validated: a row that doesn't parse is a bug, not user input. */
  function configOf(row: { config: unknown }): ConnectionConfig {
    return connectionConfigSchema.parse(row.config);
  }

  /** The connections of an org this member can query: the org's, and their own sign-ins. */
  const usableBy = ({ userId, orgId }: Scope) =>
    and(eq(dataConnections.orgId, orgId), or(eq(dataConnections.sharing, "org"), eq(dataConnections.userId, userId)));

  /** A connection's facts for the policy. */
  const asConnection = (row: { userId: string; sharing: DataConnectionRow["sharing"] }, userId: string, role: OrgRole | null): ConnectionFacts => ({
    kind: "connection",
    role,
    own: row.userId === userId,
    sharing: row.sharing,
  });

  /** A connection and the caller's role in its org, or null: no such connection, or they aren't a member. */
  async function lookup(userId: string, id: string) {
    if (!isUuid(id)) return null;
    const [row] = await db.select().from(dataConnections).where(eq(dataConnections.id, id)).limit(1);
    if (!row) return null;
    const role = await roleIn(db, userId, row.orgId);
    return role ? { row, role, own: row.userId === userId, facts: asConnection(row, userId, role) } : null;
  }

  /**
   * A connection and the caller's facts about it, or null when they can't
   * even use it (the policy's connection.use). `own`: they added it.
   */
  async function find(userId: string, id: string) {
    const found = await lookup(userId, id);
    if (!found || !can("connection", "use", found.facts)) return null;
    return found;
  }

  /** Which server a stored connection points at, for matching two sign-ins to the same place. */
  const serverOf = (row: { config: unknown }) => {
    const url = (row.config as { url?: unknown } | null)?.url;
    return typeof url === "string" ? url : null;
  };

  /**
   * A teammate's personal sign-in the caller can't use, if `id` is one: the
   * caller's queries never run as someone else, so it's theirs to answer with
   * a sign-in of their own to the same server. With `own`, the one they have.
   */
  async function someoneElsesSignIn(userId: string, id: string) {
    const found = await lookup(userId, id);
    if (!found || found.own || found.row.sharing !== "personal" || !found.row.orgId) return null;
    const server = serverOf(found.row);
    if (!server) return null;
    const mine = await db
      .select()
      .from(dataConnections)
      .where(
        and(
          eq(dataConnections.orgId, found.row.orgId),
          eq(dataConnections.userId, userId),
          // Theirs, whether or not they've shared it with the workspace.
          eq(dataConnections.type, found.row.type),
        ),
      )
      .orderBy(asc(dataConnections.createdAt));
    return { theirs: found.row, own: mine.find((row) => serverOf(row) === server) ?? null };
  }

  /**
   * A connection for a guest of an app: someone outside the workspace, let in
   * to view that app. Only one of the workspace's own connections (never a
   * personal sign-in) that the app already uses.
   */
  async function forGuest(userId: string, appId: string, connectionId: string) {
    if (!isUuid(connectionId)) return null;
    const grant = await appAccess(db, userId, appId);
    if (!grant?.guest) return null;
    const [row] = await db
      .select({ connection: dataConnections })
      .from(appConnections)
      .innerJoin(dataConnections, eq(dataConnections.id, appConnections.connectionId))
      .where(
        and(
          eq(appConnections.appId, appId),
          eq(appConnections.connectionId, connectionId),
          eq(dataConnections.orgId, grant.orgId),
          eq(dataConnections.sharing, "org"),
        ),
      )
      .limit(1);
    return row?.connection ?? null;
  }

  /** A connection the caller may change or delete, as a result: missing and "use only" stay distinct. */
  async function findManaged(userId: string, id: string, action: "update" | "delete"): Promise<Result<DataConnectionRow>> {
    const found = await find(userId, id);
    if (!found) return notFound();
    const decision = decide("connection", action, found.facts);
    return decision.allowed ? ok(found.row) : refusal(decision);
  }

  /** The apps that use a connection: the ones the caller can open by name, the rest as a count. */
  async function appsUsing(userId: string, connectionId: string) {
    const rows = await db
      .select({ id: apps.id, name: apps.name, open: sql<boolean>`${appOpenTo(userId)}` })
      .from(appConnections)
      .innerJoin(apps, eq(apps.id, appConnections.appId))
      .where(eq(appConnections.connectionId, connectionId))
      .orderBy(asc(apps.name));
    const visible = rows.filter((app) => app.open);
    return { visible: visible.map(({ id, name }) => ({ id, name })), hidden: rows.length - visible.length };
  }

  /** Pending sign-ins are sealed for their user and their own (hashed) state. */
  const signInContext = (userId: string, stateHash: string): SecretContext => ({ purpose: "mcp-oauth-sign-in", userId, connectionId: stateHash });

  /**
   * Changes a connection's stored credential (new OAuth tokens, say), one
   * change at a time per connection. Under a Postgres advisory lock, it reads
   * the credential as stored now (another request may have just refreshed it),
   * lets `change` decide, and writes the result in the same transaction, so two
   * dashboard queries can't both refresh and spend a rotating refresh token twice.
   */
  async function updateCredential(
    ownerId: string,
    connectionId: string,
    type: ConnectionType,
    change: (current: string) => Promise<{ credential: string; status?: "ok" | "invalid" }>,
  ): Promise<string> {
    const ctx = context(type, ownerId, connectionId);
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connectionId}, 0))`);
        const [row] = await tx
          .select()
          .from(dataConnections)
          .where(eq(dataConnections.id, connectionId))
          .limit(1);
        if (!row) throw new Error("Connection disappeared while its credential was being updated");
        const current = await openCredential(row.secret, ctx);
        const next = await change(current);
        if (next.credential === current && !next.status) return current;
        const tooLarge = refuseIfTooLarge(type, next.credential, "replace");
        if (tooLarge) throw new SecretTooLargeError(secretBytes(next.credential));
        await tx
          .update(dataConnections)
          .set({
            secret: await sealCredential(next.credential, ctx),
            credentialHint: deps.sources(type).credential.hint(next.credential),
            status: next.status ?? "ok",
            lastCheckedAt: now(),
            updatedAt: now(),
          })
          .where(eq(dataConnections.id, connectionId));
        return next.credential;
      });
    } finally {
      keyCache.delete(connectionId);
    }
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

  /**
   * A failed check as a user-facing error and the status to record, or null when it's not a known failure.
   * The user only sees our own wording; what the server itself said goes to the log, so a cause we
   * don't name yet can be found and given a message.
   */
  function knownFailure(error: unknown, type: ConnectionType) {
    const known = fromCheckError(error);
    if (known) logRejection(`connections.check.${type}.${known.error.code}`, error);
    return known;
  }

  /** A failed check as a result, or rethrown when it's not a known failure. */
  function checkFailure(error: unknown, type: ConnectionType): Result<never> {
    const known = knownFailure(error, type);
    if (known) return fail(known.error);
    throw error;
  }

  /** Deletes a connection, or uninstalls a demo dataset, if no app uses it. */
  async function removeRow(userId: string, row: DataConnectionRow): Promise<Result<undefined>> {
    const inUse = ({ visible, hidden }: { visible: { id: string; name: string }[]; hidden: number }) => {
      const what = row.demoDataset === null ? "connection" : "demo dataset";
      return fail({
        code: "in_use",
        message: visible.length
          ? `Dashboards in these apps use this ${what}. Delete those apps first.`
          : `Dashboards in ${hidden === 1 ? "another member's app" : "other members' apps"} use this ${what}, so it can't be deleted.`,
        apps: visible,
      });
    };

    const users = await appsUsing(userId, row.id);
    if (users.visible.length || users.hidden) return inUse(users);

    try {
      await db.delete(dataConnections).where(eq(dataConnections.id, row.id));
    } catch (error) {
      // An app was added between the check and the delete: the foreign key caught it.
      if (isForeignKeyViolation(error)) return inUse(await appsUsing(userId, row.id));
      throw error;
    }
    keyCache.delete(row.id);
    return ok(undefined);
  }

  const service = {
    /** The connections the member can query in the org: the org's own, and their own sign-ins. */
    async list(scope: Scope): Promise<ConnectionSummary[]> {
      const role = await roleIn(db, scope.userId, scope.orgId);
      if (!role) return [];
      const rows = await db
        .select({
          id: dataConnections.id,
          name: dataConnections.name,
          type: dataConnections.type,
          config: dataConnections.config,
          credentialHint: dataConnections.credentialHint,
          status: dataConnections.status,
          lastCheckedAt: dataConnections.lastCheckedAt,
          demoDataset: dataConnections.demoDataset,
          sharing: dataConnections.sharing,
          ownerId: dataConnections.userId,
          ownerEmail: users.email,
        })
        .from(dataConnections)
        .leftJoin(users, eq(users.id, dataConnections.userId))
        .where(usableBy(scope))
        .orderBy(asc(dataConnections.createdAt));

      // "Used by" names only the apps this member can open.
      const appRows = await db
        .select({ id: apps.id, name: apps.name, connectionId: appConnections.connectionId })
        .from(appConnections)
        .innerJoin(apps, eq(apps.id, appConnections.appId))
        .where(appsOpenTo(scope))
        .orderBy(asc(apps.name));

      const summaries: ConnectionSummary[] = [];
      for (const { config, demoDataset, ownerId, ownerEmail, ...row } of rows) {
        const used = appRows.filter((app) => app.connectionId === row.id).map(({ id, name }) => ({ id, name }));
        const mine = ownerId === scope.userId;
        const facts = asConnection({ userId: ownerId, sharing: row.sharing }, scope.userId, role);
        const access = {
          mine,
          addedBy: mine ? null : ownerEmail,
          canManage: can("connection", "update", facts),
          facts,
        };
        if (demoDataset === null) {
          const parsed = configOf({ config });
          const signIn = "oauth" in parsed && parsed.oauth ? "oauth" : null;
          summaries.push({ ...row, ...describeConnection(parsed), ...access, signIn, apps: used, demo: null });
          continue;
        }
        // A demo dataset no longer on offer reads as gone, like a deleted connection.
        const dataset = demoDatasetFor(demoDataset);
        if (!dataset) continue;
        summaries.push({
          ...row,
          ...describeDemo(dataset),
          ...access,
          signIn: null,
          apps: used,
          demo: { key: dataset.key, description: dataset.description, summary: dataset.summary },
        });
      }
      return summaries;
    },

    /** Every demo dataset on offer, and whether the org has it installed. */
    async listDemoDatasets(scope: Scope): Promise<DemoDatasetSummary[]> {
      const datasets = demoDatasets();
      if (!datasets.length) return [];
      const installed = (await service.list(scope)).filter((connection) => connection.demo);
      return datasets.map((dataset) => {
        const connection = installed.find((candidate) => candidate.demo?.key === dataset.key);
        return {
          key: dataset.key,
          name: dataset.name,
          description: dataset.description,
          summary: dataset.summary,
          prompts: dataset.prompts,
          connectionId: connection?.id ?? null,
          apps: connection?.apps ?? [],
        };
      });
    },

    /**
     * Installs a demo dataset for the org: a connection of its own that
     * points at it. Installing one that's already installed returns it.
     */
    installDemo(scope: Scope, input: unknown): Promise<Result<{ id: string }>> {
      return guard("installDemo", async () => {
        const adding = decide("sampleData", "create", await workspaceFacts(db, scope.userId, scope.orgId));
        if (!adding.allowed) return refusal(adding);
        const parsed = demoRefSchema.safeParse(input);
        const dataset = parsed.success ? demoDatasetFor(parsed.data.dataset) : undefined;
        if (!dataset) return fail({ code: "not_found", message: "This demo dataset isn't available." });

        await db
          .insert(dataConnections)
          .values({
            id: randomUUID(),
            userId: scope.userId,
            orgId: scope.orgId,
            sharing: "org",
            name: dataset.name,
            type: "postgres",
            config: { type: "postgres", ...dataset.postgres },
            secret: null,
            credentialHint: "shared, read-only",
            demoDataset: dataset.key,
            status: "ok",
            lastCheckedAt: now(),
          })
          .onConflictDoNothing();
        const [row] = await db
          .select({ id: dataConnections.id })
          .from(dataConnections)
          .where(and(eq(dataConnections.orgId, scope.orgId), eq(dataConnections.demoDataset, dataset.key)))
          .limit(1);
        return row ? ok({ id: row.id }) : internalError();
      });
    },

    /** Uninstalls a demo dataset no app uses. Uninstalling one that isn't installed succeeds. */
    uninstallDemo(scope: Scope, input: unknown): Promise<Result<undefined>> {
      return guard("uninstallDemo", async () => {
        const removing = decide("sampleData", "delete", await workspaceFacts(db, scope.userId, scope.orgId));
        if (!removing.allowed) return refusal(removing);
        const parsed = demoRefSchema.safeParse(input);
        if (!parsed.success) return fail({ code: "not_found", message: "This demo dataset isn't available." });
        const [row] = await db
          .select()
          .from(dataConnections)
          .where(and(eq(dataConnections.orgId, scope.orgId), eq(dataConnections.demoDataset, parsed.data.dataset)))
          .limit(1);
        return row ? removeRow(scope.userId, row) : ok(undefined);
      });
    },

    /**
     * Tests the credential against the source and saves the connection only if
     * it works. It belongs to the org and serves every member: a key, password
     * or service account is never personal.
     */
    create(scope: Scope, input: unknown): Promise<Result<{ id: string; warnings: ConnectionWarning[] }>> {
      return guard("create", async () => {
        const { userId, orgId } = scope;
        const creating = decide("connection", "create", await workspaceFacts(db, userId, orgId));
        if (!creating.allowed) return refusal(creating);
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
        const tooLarge = refuseIfTooLarge(type, credential.data, "create");
        if (tooLarge) return tooLarge;

        const config = { type, ...settings.data } as ConnectionConfig;
        const id = randomUUID();
        let warnings: ConnectionWarning[];
        try {
          // Sealed first: no point testing a credential we can't store.
          const secret = await sealCredential(credential.data, context(type, userId, id));
          warnings = await check(config, credential.data);
          await db.insert(dataConnections).values({
            id,
            userId,
            orgId,
            sharing: "org",
            name,
            type,
            config,
            secret,
            credentialHint: source.credential.hint(credential.data),
            status: "ok",
            lastCheckedAt: now(),
          });
        } catch (error) {
          return checkFailure(error, type);
        }
        return ok({ id, warnings });
      });
    },

    /** Checks a saved connection again and records the outcome. */
    retest(userId: string, input: unknown): Promise<Result<{ status: ConnectionStatus }>> {
      return guard("retest", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const managed = await findManaged(userId, parsed.data.id, "update");
        if (!managed.ok) return managed;
        const row = managed.data;
        if (row.demoDataset !== null) return demoReadOnly();

        let failure: { error: ConnectionError; status: Exclude<ConnectionStatus, "ok"> } | null = null;
        try {
          const config = configOf(row);
          const credential = await keyCache.get(row.id, () =>
            openCredential(row.secret, context(config.type, row.userId, row.id)),
          );
          const { type, ...settings } = config;
          const source = deps.sources(type);
          if (source.retest) {
            await source.retest({
              id: row.id,
              name: row.name,
              config: settings,
              credential,
              updateCredential: (change) => updateCredential(row.userId, row.id, type, change),
            });
          } else {
            await check(config, credential);
          }
        } catch (error) {
          failure = knownFailure(error, row.type as ConnectionType);
          if (!failure) throw error;
          keyCache.delete(row.id);
        }

        const status = failure ? failure.status : "ok";
        await db
          .update(dataConnections)
          .set({ status, lastCheckedAt: now(), updatedAt: now() })
          .where(eq(dataConnections.id, row.id));

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
        const managed = await findManaged(userId, parsed.data.id, "update");
        if (!managed.ok) return managed;
        const row = managed.data;
        if (row.demoDataset !== null) return demoReadOnly();

        const config = configOf(row);
        const source = deps.sources(config.type);
        const credential = source.credential.schema.safeParse(parsed.data.credential);
        if (!credential.success) return fromValidation(credential.error, () => source.credential.field);
        const tooLarge = refuseIfTooLarge(config.type, credential.data, "replace");
        if (tooLarge) return tooLarge;

        let warnings: ConnectionWarning[];
        try {
          const secret = await sealCredential(credential.data, context(config.type, row.userId, row.id));
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
            .where(eq(dataConnections.id, row.id));
        } catch (error) {
          return checkFailure(error, config.type);
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
        const managed = await findManaged(userId, parsed.data.id, "update");
        if (!managed.ok) return managed;
        const updated = await db
          .update(dataConnections)
          .set({ name: parsed.data.name, updatedAt: now() })
          .where(and(eq(dataConnections.id, parsed.data.id), isNull(dataConnections.demoDataset)))
          .returning({ id: dataConnections.id });
        return updated.length ? ok(undefined) : notFound();
      });
    },

    /** Deletes a connection no app uses. */
    remove(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("remove", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const managed = await findManaged(userId, parsed.data.id, "delete");
        if (!managed.ok) return managed;
        return removeRow(userId, managed.data);
      });
    },

    /**
     * Shares a sign-in with the whole org, or takes it back. Only whoever
     * signed in can: once shared, every member's queries run as them. Taking
     * it back is theirs whatever their role, a viewer's included: nobody
     * should keep querying as them against their will. A connection with a
     * key or password always serves the org.
     */
    setSharing(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("setSharing", async () => {
        const parsed = sharingSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const found = await find(userId, parsed.data.id);
        if (!found) return notFound();
        // Taking it back is theirs whatever their role; sharing it also needs an editor or admin.
        const unsharing = decide("connection", "stopSharing", found.facts);
        if (!unsharing.allowed) return refusal(unsharing);
        if (parsed.data.sharing === "org") {
          const sharing = decide("connection", "share", found.facts);
          if (!sharing.allowed) return refusal(sharing);
        }
        const config = found.row.demoDataset === null ? configOf(found.row) : null;
        if (!config || !("oauth" in config && config.oauth)) {
          return fail({ code: "validation", message: "Only a connection you signed in to can be personal. This one serves the whole workspace." });
        }
        await db.update(dataConnections).set({ sharing: parsed.data.sharing, updatedAt: now() }).where(eq(dataConnections.id, found.row.id));
        return ok(undefined);
      });
    },

    /**
     * A connection opened for a tool: its settings and decrypted credential,
     * only if the caller can query it and it is of `type`. With `orgId`, only
     * if it belongs to that org too: an app only ever queries its own org's
     * connections. A teammate's personal sign-in opens as the caller's own
     * sign-in to the same server (the returned `id` is then theirs), never as
     * the teammate. With `appId`, a guest of that app (who isn't in its
     * workspace) can open the workspace's connections that the app uses, and
     * no others. Server code only; the credential never leaves the server.
     */
    async open(
      userId: string,
      connectionId: string,
      type: ConnectionType,
      { orgId, appId }: { orgId?: string; appId?: string } = {},
    ): Promise<OpenConnection<Record<string, unknown>> | null> {
      // Someone else's personal sign-in opens as the caller's own sign-in to the same server, or not at all.
      const row =
        (await find(userId, connectionId))?.row ??
        (await someoneElsesSignIn(userId, connectionId))?.own ??
        (appId ? await forGuest(userId, appId, connectionId) : null);
      if (!row || row.type !== type) return null;
      if (orgId !== undefined && row.orgId !== orgId) return null;
      if (row.demoDataset !== null) {
        // Where it points and the shared read-only password come from config, never the row.
        const dataset = demoDatasetFor(row.demoDataset);
        const password = deps.demo?.password();
        if (!dataset || !password) return null;
        return { id: row.id, name: row.name, config: { ...dataset.postgres }, credential: password };
      }
      const { type: _type, ...settings } = configOf(row);
      // Sealed for whoever added it, whoever in the org is asking.
      const credential = await keyCache.get(row.id, () => openCredential(row.secret, context(type, row.userId, row.id)));
      return {
        id: row.id,
        name: row.name,
        config: settings,
        credential,
        updateCredential: (change) => updateCredential(row.userId, row.id, type, change),
      };
    },

    /**
     * Whose sign-in a connection is, for telling someone else that it
     * expired: only its owner can sign in again. Null when it's the caller's
     * own. The email only for a member of its workspace: a guest isn't told
     * who is in it.
     */
    async signInOwner(userId: string, connectionId: string): Promise<{ name: string; email: string | null } | null> {
      if (!isUuid(connectionId)) return null;
      const [row] = await db
        .select({ name: dataConnections.name, ownerId: dataConnections.userId, orgId: dataConnections.orgId, email: users.email })
        .from(dataConnections)
        .leftJoin(users, eq(users.id, dataConnections.userId))
        .where(eq(dataConnections.id, connectionId))
        .limit(1);
      if (!row || row.ownerId === userId) return null;
      return { name: row.name, email: (await roleIn(db, userId, row.orgId)) ? row.email : null };
    },

    /**
     * For a connection that didn't open: the teammate's personal sign-in it
     * is, when the reason is that the caller has no sign-in of their own to
     * that server. Its name and where it points, so they can be asked to sign in.
     */
    async signInNeeded(userId: string, connectionId: string): Promise<{ orgId: string; name: string; config: ConnectionConfig } | null> {
      const other = await someoneElsesSignIn(userId, connectionId);
      if (!other || other.own || !other.theirs.orgId || other.theirs.demoDataset !== null) return null;
      return { orgId: other.theirs.orgId, name: other.theirs.name, config: configOf(other.theirs) };
    },

    /**
     * Keeps a started OAuth sign-in until the browser comes back: the user it
     * belongs to, the connection it will become, and (sealed) the PKCE verifier
     * and client registration. Found later by the state's hash only.
     */
    startSignIn(
      scope: Scope,
      sign: { stateHash: string; connectionId: string | null; name: string; config: ConnectionConfig; pending: string },
      /** Signing in to a server a teammate's personal connection points at: any member may, to see its data as themselves. */
      { ownCopy = false }: { ownCopy?: boolean } = {},
    ): Promise<Result<undefined>> {
      return guard("startSignIn", async () => {
        const { userId, orgId } = scope;
        if (sign.connectionId) {
          // Signing in again is for whoever signed in the first time: the connection keeps running as them.
          const existing = await find(userId, sign.connectionId);
          if (!existing) return notFound();
          const again = decide("connection", "signInAgain", existing.facts);
          if (!again.allowed) return refusal(again);
        } else {
          const workspace = await workspaceFacts(db, userId, orgId);
          const starting = ownCopy ? decide("connection", "signInAsSelf", workspace) : decide("connection", "create", workspace);
          if (!starting.allowed) return refusal(starting);
        }
        const tooLarge = refuseIfTooLarge(sign.config.type, sign.pending, "create");
        if (tooLarge) return tooLarge;
        // Old, abandoned sign-ins go first.
        await db.delete(mcpOAuthSignIns).where(lt(mcpOAuthSignIns.expiresAt, now()));
        const secret = await deps.secrets().seal(sign.pending, signInContext(userId, sign.stateHash));
        await db.insert(mcpOAuthSignIns).values({
          stateHash: sign.stateHash,
          userId,
          orgId,
          connectionId: sign.connectionId,
          name: sign.name,
          config: sign.config,
          secret,
          expiresAt: new Date(now().getTime() + (deps.signInTtlMs ?? DEFAULT_SIGN_IN_TTL_MS)),
        });
        return ok(undefined);
      });
    },

    /**
     * Takes a started sign-in back, once: only for the user who started it, only
     * before it expires. Deleted as it's read, so a callback can't be replayed.
     */
    async takeSignIn(
      userId: string,
      stateHash: string,
    ): Promise<{ orgId: string | null; connectionId: string | null; name: string; config: ConnectionConfig; pending: string } | null> {
      const [row] = await db
        .delete(mcpOAuthSignIns)
        .where(and(eq(mcpOAuthSignIns.stateHash, stateHash), eq(mcpOAuthSignIns.userId, userId), gt(mcpOAuthSignIns.expiresAt, now())))
        .returning();
      if (!row) return null;
      const pending = await deps.secrets().open(row.secret, signInContext(userId, stateHash));
      return { orgId: row.orgId, connectionId: row.connectionId, name: row.name, config: connectionConfigSchema.parse(row.config), pending };
    },

    /**
     * Saves a connection a finished OAuth sign-in produced, after checking it
     * works: a new one, or new tokens for an existing one of this user's.
     */
    saveSignedIn(
      userId: string,
      input: { orgId: string | null; connectionId: string | null; name: string; config: ConnectionConfig; credential: string },
    ): Promise<Result<{ id: string; warnings: ConnectionWarning[] }>> {
      return guard("saveSignedIn", async () => {
        const config = connectionConfigSchema.parse(input.config);
        const source = deps.sources(config.type);
        const tooLarge = refuseIfTooLarge(config.type, input.credential, input.connectionId ? "replace" : "create");
        if (tooLarge) return tooLarge;

        if (input.connectionId) {
          const existing = await find(userId, input.connectionId);
          // Only ever the sign-in's own owner, finishing what they started: anything else reads as gone.
          if (!existing || !can("connection", "signInAgain", existing.facts)) return notFound();
          const { row } = existing;
          if (row.type !== config.type || row.demoDataset !== null) return notFound();
          try {
            const secret = await sealCredential(input.credential, context(config.type, userId, row.id));
            const warnings = await check(config, input.credential);
            await db
              .update(dataConnections)
              .set({ config, secret, credentialHint: source.credential.hint(input.credential), status: "ok", lastCheckedAt: now(), updatedAt: now() })
              .where(eq(dataConnections.id, row.id));
            return ok({ id: row.id, warnings });
          } catch (error) {
            return checkFailure(error, config.type);
          } finally {
            keyCache.delete(row.id);
          }
        }

        // A new sign-in is its owner's alone until they choose to share it. Starting it was what needed
        // permission; this only finishes one this user started, in a workspace they're still in.
        if (!input.orgId || !can("workspace", "view", await workspaceFacts(db, userId, input.orgId))) return notFound();
        const id = randomUUID();
        try {
          const secret = await sealCredential(input.credential, context(config.type, userId, id));
          const warnings = await check(config, input.credential);
          await db.insert(dataConnections).values({
            id,
            userId,
            orgId: input.orgId,
            sharing: "personal",
            name: input.name,
            type: config.type,
            config,
            secret,
            credentialHint: source.credential.hint(input.credential),
            status: "ok",
            lastCheckedAt: now(),
          });
          return ok({ id, warnings });
        } catch (error) {
          return checkFailure(error, config.type);
        }
      });
    },
  };
  return service;
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

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
