import { randomUUID } from "node:crypto";

import { waitUntil } from "@vercel/functions";

import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";

import type { DemoDataset } from "@/config";
import type { Database } from "@/lib/db";
import {
  appConnections,
  apps,
  connectionSignIns,
  dataConnections,
  mcpOAuthSignIns,
  users,
  type ConnectionSharing,
  type ConnectionSignInRow,
  type ConnectionStatus,
  type DataConnectionRow,
  type OrgRole,
} from "@/lib/db/schema";
import { track } from "@/lib/analytics";
import { logError, logRejection, logWarning } from "@/lib/log";
import { appAccess, appOpenTo, appsOpenTo, isUuid, roleIn, workspaceFacts, type Scope } from "@/lib/orgs/access";
import { can, decide, refusal, type ConnectionFacts, type ConnectionKind } from "@/lib/orgs/policy";
import { OPEN_GATE, type Gate } from "@/lib/entitlements";
import { count } from "@/lib/metrics";
import type { SecretBox, SecretContext } from "@/lib/secrets";
import { MAX_SECRET_BYTES, SecretTooLargeError, secretBytes, type SealedSecret } from "@/lib/secrets/types";
import {
  CONNECTION_TYPES,
  connectionConfigSchema,
  describeConnection,
  SOURCE_OPTIONS,
  type ConnectionConfig,
  type ConnectionType,
  type SourceOption,
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
} from "./schemas";
import type { DeletedSignIns } from "./deleted-sign-ins";
import { connectionKind, isSignIn } from "./kind";

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
  /** org: shared with the workspace, one credential for everyone. personal: requires each member's own sign-in. */
  sharing: ConnectionSharing;
  kind: ConnectionKind;
  /**
   * For a sign-in, the one queries use: a shared one's, or the caller's own
   * of one that requires sign-in. none: nobody (shared) or not the caller
   * (requires sign-in) is signed in. Null for a key.
   */
  signInStatus: "signedIn" | "expired" | "none" | null;
  /** Whom a shared sign-in runs as, by email. Null for anything else, and when nobody is signed in. */
  signedInAs: string | null;
  /** Whether the caller added it. */
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
  /** The workspace's plan: whether it may add a connection or rename one. Everything allowed without. */
  gate?: Gate;
  /**
   * Source types this person can't add in this workspace (still rolling out,
   * behind a feature flag): lib/sources/flags in the app. Every type allowed without.
   */
  notOffered?: (scope: Scope) => Promise<readonly ConnectionType[]>;
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
 * The data access layer for connections. A connection belongs to an org, and
 * what it is is fixed when it's added (lib/orgs/policy's ConnectionKind):
 * shared with the workspace, with one credential everyone's queries use (a
 * key, or one person's sign-in), or requiring sign-in, where each member signs
 * in with their own account and their queries run as them. Every member sees
 * every connection of their workspace.
 *
 * Every function takes the user id (and, where it matters, the org) from the
 * caller's verified session and checks membership in the database: a
 * connection the caller can't see is indistinguishable from one that doesn't
 * exist. A key stays sealed for the user who added the connection (`user_id`);
 * a sign-in's tokens (`connection_sign_ins`) for whoever signed in. Anything
 * specific to a source type comes from that source (lib/sources).
 */
export function createConnectionService(deps: ConnectionServiceDeps) {
  const { db } = deps;
  const gate = deps.gate ?? OPEN_GATE;
  const notOffered = deps.notOffered ?? (async () => []);

  /** Refuses adding a connection of a type that isn't offered to this person here. */
  async function refuseNotOffered(scope: Scope, type: ConnectionType): Promise<Result<never> | null> {
    if (!(await notOffered(scope)).includes(type)) return null;
    return fail({ code: "not_available", message: "This source isn't available in this workspace yet." });
  }
  const now = deps.now ?? (() => new Date());

  /** Adds a connection row (and anything with it) only if the plan still allows one, under the plan's lock. */
  async function insertWithinPlan(orgId: string, insert: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<void>) {
    return db.transaction(async (tx) => {
      const refused = await gate(tx, orgId, "createConnection");
      if (refused) return fail(refused);
      await insert(tx);
      return null;
    });
  }
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

  /**
   * After sign-ins are deleted: lets the source let go of what they held
   * elsewhere (a Composio account, with its ad platform tokens). Best effort.
   */
  async function releaseSignIns(type: ConnectionType, signIns: ConnectionSignInRow[]): Promise<void> {
    const source = deps.sources(type);
    if (!source.release) return;
    for (const signIn of signIns) {
      try {
        await source.release(await openCredential(signIn.secret, context(type, signIn.userId, signIn.connectionId)));
      } catch (error) {
        logError("connections.releaseSignIn", error);
      }
    }
  }

  /** The same for sign-ins started and not finished, once their rows are deleted. Best effort. */
  async function releasePending(rows: DeletedSignIns["pending"]): Promise<void> {
    for (const row of rows) {
      const config = connectionConfigSchema.safeParse(row.config);
      const source = config.success ? deps.sources(config.data.type) : null;
      if (!source?.releasePending) continue;
      try {
        await source.releasePending(await deps.secrets().open(row.secret, signInContext(row.userId, row.stateHash)));
      } catch (error) {
        logError("connections.releasePending", error);
      }
    }
  }

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

  /** The connections of an org: every member sees them all. */
  const inWorkspace = ({ orgId }: Scope) => eq(dataConnections.orgId, orgId);

  /**
   * The sign-in a connection's queries run with for this caller: the one of
   * a shared sign-in, whoever holds it, or the caller's own of one that
   * requires sign-in. Null for a key, and when there's none.
   */
  async function signInFor(row: DataConnectionRow, userId: string): Promise<ConnectionSignInRow | null> {
    const kind = connectionKind(row);
    if (kind === "key") return null;
    const [signIn] = await db
      .select()
      .from(connectionSignIns)
      .where(
        kind === "signInShared"
          ? eq(connectionSignIns.connectionId, row.id)
          : and(eq(connectionSignIns.connectionId, row.id), eq(connectionSignIns.userId, userId)),
      )
      .orderBy(asc(connectionSignIns.createdAt))
      .limit(1);
    return signIn ?? null;
  }

  /** A connection's facts for the policy, with the sign-in it runs with for the caller. */
  const asConnection = (
    row: { userId: string; sharing: ConnectionSharing; config: unknown; demoDataset: string | null },
    signIn: { userId: string } | null,
    userId: string,
    role: OrgRole | null,
  ): ConnectionFacts => {
    const kind = connectionKind(row);
    return {
      kind: "connection",
      role,
      own: row.userId === userId,
      signedIn: signIn?.userId === userId,
      empty: kind === "signInShared" && !signIn,
      connection: kind,
    };
  };

  /** A connection and the caller's facts about it, or null: no such connection, or they aren't a member. */
  async function lookup(userId: string, id: string) {
    if (!isUuid(id)) return null;
    const [row] = await db.select().from(dataConnections).where(eq(dataConnections.id, id)).limit(1);
    if (!row) return null;
    const role = await roleIn(db, userId, row.orgId);
    if (!role) return null;
    const signIn = await signInFor(row, userId);
    return { row, signIn, role, own: row.userId === userId, facts: asConnection(row, signIn, userId, role) };
  }

  /**
   * A connection and the caller's facts about it, or null when they can't
   * even see it (the policy's connection.use). `own`: they added it.
   */
  async function find(userId: string, id: string) {
    const found = await lookup(userId, id);
    if (!found || !can("connection", "use", found.facts)) return null;
    return found;
  }

  /**
   * A connection for a guest of an app: someone outside the workspace, let in
   * to view that app. Only one shared with the workspace (never one that
   * requires sign-in, which a guest has none of) that the app already uses.
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
  async function findManaged(
    userId: string,
    id: string,
    action: "update" | "delete",
  ): Promise<Result<{ row: DataConnectionRow; signIn: ConnectionSignInRow | null }>> {
    const found = await find(userId, id);
    if (!found) return notFound();
    const decision = decide("connection", action, found.facts);
    return decision.allowed ? ok({ row: found.row, signIn: found.signIn }) : refusal(decision);
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
   * Changes a sign-in's stored tokens (refreshed, say), one change at a time
   * per sign-in. Under a Postgres advisory lock, it reads the tokens as stored
   * now (another request may have just refreshed them), lets `change` decide,
   * and writes the result in the same transaction, so two dashboard queries
   * can't both refresh and spend a rotating refresh token twice.
   */
  async function updateSignIn(
    signInId: string,
    type: ConnectionType,
    change: (current: string) => Promise<{ credential: string; status?: "ok" | "invalid" }>,
  ): Promise<string> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${signInId}, 0))`);
        const [row] = await tx
          .select({ signIn: connectionSignIns, orgId: dataConnections.orgId, sharing: dataConnections.sharing })
          .from(connectionSignIns)
          .innerJoin(dataConnections, eq(dataConnections.id, connectionSignIns.connectionId))
          .where(eq(connectionSignIns.id, signInId))
          .limit(1);
        if (!row) throw new Error("Sign-in disappeared while its tokens were being updated");
        const { signIn } = row;
        const ctx = context(type, signIn.userId, signIn.connectionId);
        const current = await openCredential(signIn.secret, ctx);
        const next = await change(current);
        if (next.credential === current && !next.status) return current;
        // Once, when it goes from working to expired: for whoever signed in, in the connection's workspace.
        if (next.status === "invalid" && signIn.status !== "invalid") {
          track(signIn.userId, "connection_sign_in_expired", { source_type: type, shared: row.sharing === "org" }, row.orgId);
        }
        const tooLarge = refuseIfTooLarge(type, next.credential, "replace");
        if (tooLarge) throw new SecretTooLargeError(secretBytes(next.credential));
        await tx
          .update(connectionSignIns)
          .set({ secret: await sealCredential(next.credential, ctx), status: next.status ?? "ok", lastCheckedAt: now(), updatedAt: now() })
          .where(eq(connectionSignIns.id, signInId));
        return next.credential;
      });
    } finally {
      keyCache.delete(signInId);
    }
  }

  /**
   * The credential a connection's queries use for the caller: its key, or the
   * sign-in it runs with (`signIn`). Cached by whichever it is.
   */
  function credentialOf(row: DataConnectionRow, signIn: ConnectionSignInRow | null, type: ConnectionType) {
    if (signIn) {
      return {
        credential: () => keyCache.get(signIn.id, () => openCredential(signIn.secret, context(type, signIn.userId, row.id))),
        updateCredential: (change: Parameters<typeof updateSignIn>[2]) => updateSignIn(signIn.id, type, change),
      };
    }
    return {
      credential: () => keyCache.get(row.id, () => openCredential(row.secret, context(type, row.userId, row.id))),
      updateCredential: undefined,
    };
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
      const total = visible.length + hidden;
      return fail({
        code: "in_use",
        message: `${total === 1 ? "1 app uses" : `${total} apps use`} this ${what}. Delete ${total === 1 ? "it" : "them"} first.`,
        apps: visible,
      });
    };

    const users = await appsUsing(userId, row.id);
    if (users.visible.length || users.hidden) return inUse(users);

    const type = row.type as ConnectionType;
    const signIns = deps.sources(type).release ? await db.select().from(connectionSignIns).where(eq(connectionSignIns.connectionId, row.id)) : [];
    try {
      await db.delete(dataConnections).where(eq(dataConnections.id, row.id));
    } catch (error) {
      // An app was added between the check and the delete: the foreign key caught it.
      if (isForeignKeyViolation(error)) return inUse(await appsUsing(userId, row.id));
      throw error;
    }
    keyCache.delete(row.id);
    await releaseSignIns(type, signIns);
    return ok(undefined);
  }

  const service = {
    /** Every connection of the org, as the member sees it: with their own sign-in where it requires one. */
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
        .where(inWorkspace(scope))
        .orderBy(asc(dataConnections.createdAt));

      // The sign-ins to these connections, for the one each runs with for this member (`signInFor`).
      const signInRows = rows.length
        ? await db
            .select({ connectionId: connectionSignIns.connectionId, userId: connectionSignIns.userId, status: connectionSignIns.status, email: users.email })
            .from(connectionSignIns)
            .leftJoin(users, eq(users.id, connectionSignIns.userId))
            .where(
              inArray(
                connectionSignIns.connectionId,
                rows.map((row) => row.id),
              ),
            )
            .orderBy(asc(connectionSignIns.createdAt))
        : [];
      const runsWith = (row: { id: string; sharing: ConnectionSharing }) =>
        signInRows.find((signIn) => signIn.connectionId === row.id && (row.sharing === "org" || signIn.userId === scope.userId)) ?? null;

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
        const kind = connectionKind({ config, sharing: row.sharing, demoDataset });
        const signIn = kind === "key" ? null : runsWith(row);
        const facts = asConnection({ userId: ownerId, sharing: row.sharing, config, demoDataset }, signIn, scope.userId, role);
        const access = {
          mine,
          addedBy: mine ? null : ownerEmail,
          canManage: can("connection", "update", facts),
          facts,
          kind,
          signInStatus: kind === "key" ? null : !signIn ? ("none" as const) : signIn.status === "invalid" ? ("expired" as const) : ("signedIn" as const),
          signedInAs: kind === "signInShared" ? (signIn?.email ?? null) : null,
        };
        if (demoDataset === null) {
          const parsed = configOf({ config });
          // A sign-in's status is that of the sign-in it runs with: nobody signed in reads as needing a fix.
          const status: ConnectionStatus = kind === "key" ? row.status : signIn ? signIn.status : "invalid";
          summaries.push({ ...row, status, ...describeConnection(parsed), ...access, signIn: isSignIn(parsed) ? "oauth" : null, apps: used, demo: null });
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
    /** The sources this person can add in this workspace, in catalog order. */
    async offeredSources(scope: Scope): Promise<SourceOption[]> {
      const hidden = await notOffered(scope);
      return SOURCE_OPTIONS.filter((option) => !hidden.includes(option.type));
    },

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
        // Before testing the credential, so nobody fills in a form only to hit the limit; checked again on insert.
        const early = await gate(db, orgId, "createConnection");
        if (early) return fail(early);
        const envelope = createEnvelopeSchema.safeParse(input);
        if (!envelope.success) return fromValidation(envelope.error);
        const type = envelope.data.type as ConnectionType;
        if (!(CONNECTION_TYPES as readonly string[]).includes(type)) {
          return fail({ code: "validation", message: "Unknown source type." });
        }
        const unavailable = await refuseNotOffered(scope, type);
        if (unavailable) return unavailable;
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
          const refused = await insertWithinPlan(orgId, async (tx) => {
            await tx.insert(dataConnections).values({
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
          });
          if (refused) return refused;
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
        const { row, signIn } = managed.data;
        if (row.demoDataset !== null) return demoReadOnly();
        // A sign-in is tested as the one it runs with for the caller; with none, there's nothing to test.
        if (connectionKind(row) !== "key" && !signIn) {
          return fail({ code: "reauth_required", message: `Nobody is signed in to ${row.name}. Sign in to it first.` });
        }

        let failure: { error: ConnectionError; status: Exclude<ConnectionStatus, "ok"> } | null = null;
        const config = configOf(row);
        const { type, ...settings } = config;
        const opened = credentialOf(row, signIn, type);
        try {
          const credential = await opened.credential();
          const source = deps.sources(type);
          if (source.retest) {
            await source.retest({ id: row.id, name: row.name, config: settings, credential, updateCredential: opened.updateCredential });
          } else {
            await check(config, credential);
          }
        } catch (error) {
          failure = knownFailure(error, row.type as ConnectionType);
          if (!failure) throw error;
          keyCache.delete(signIn?.id ?? row.id);
        }

        const status = failure ? failure.status : "ok";
        if (signIn) {
          await db.update(connectionSignIns).set({ status, lastCheckedAt: now(), updatedAt: now() }).where(eq(connectionSignIns.id, signIn.id));
        } else {
          await db.update(dataConnections).set({ status, lastCheckedAt: now(), updatedAt: now() }).where(eq(dataConnections.id, row.id));
        }

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
        const { row } = managed.data;
        if (row.demoDataset !== null) return demoReadOnly();
        // A sign-in's tokens come from signing in, never from a form.
        if (connectionKind(row) !== "key") return fail({ code: "validation", message: `${row.name} signs in. Sign in to it again instead.` });

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
        const refused = managed.data.row.orgId ? await gate(db, managed.data.row.orgId, "renameConnection") : null;
        if (refused) return fail(refused);
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
        const { row } = managed.data;
        const removed = await removeRow(userId, row);
        if (removed.ok) {
          track(
            userId,
            "connection_deleted",
            {
              source_type: row.type,
              is_demo: row.demoDataset !== null,
              sign_in: row.demoDataset === null && isSignIn(row.config),
              own: row.userId === userId,
            },
            row.orgId,
          );
        }
        return removed;
      });
    },

    /**
     * Deletes the caller's own sign-in to a connection, whatever their role,
     * a viewer's included: nobody keeps querying as someone against their
     * will. For a shared one, nobody is signed in to it afterwards, until
     * someone signs in again.
     */
    signOut(userId: string, input: unknown): Promise<Result<undefined>> {
      return guard("signOut", async () => {
        const parsed = connectionRefSchema.safeParse(input);
        if (!parsed.success) return notFound();
        const found = await find(userId, parsed.data.id);
        if (!found) return notFound();
        const leaving = decide("connection", "signOut", found.facts);
        if (!leaving.allowed) return refusal(leaving);
        const removed = await db
          .delete(connectionSignIns)
          .where(and(eq(connectionSignIns.connectionId, found.row.id), eq(connectionSignIns.userId, userId)))
          .returning();
        for (const { id } of removed) keyCache.delete(id);
        await releaseSignIns(found.row.type as ConnectionType, removed);
        return ok(undefined);
      });
    },

    /**
     * After sign-ins were deleted elsewhere (a member leaving, a workspace
     * deleted): lets each source let go of what they held. Best effort.
     */
    async releaseDeleted({ signIns, pending }: DeletedSignIns): Promise<void> {
      for (const { type, signIn } of signIns) {
        keyCache.delete(signIn.id);
        await releaseSignIns(type, [signIn]);
      }
      await releasePending(pending);
    },

    /**
     * A connection opened for a tool: its settings and decrypted credential,
     * only if the caller can query it and it is of `type`. With `orgId`, only
     * if it belongs to that org too: an app only ever queries its own org's
     * connections. A sign-in opens with the sign-in it runs with for the
     * caller: a shared one's, or their own; with none, it doesn't open (`whyClosed`
     * says why). With `appId`, a guest of that app (who isn't in its workspace)
     * can open the connections shared with the workspace that the app uses,
     * and no others. Server code only; the credential never leaves the server.
     */
    async open(
      userId: string,
      connectionId: string,
      type: ConnectionType,
      { orgId, appId }: { orgId?: string; appId?: string } = {},
    ): Promise<OpenConnection<Record<string, unknown>> | null> {
      const row = (await find(userId, connectionId))?.row ?? (appId ? await forGuest(userId, appId, connectionId) : null);
      if (!row || row.type !== type) return null;
      if (orgId !== undefined && row.orgId !== orgId) return null;
      if (row.demoDataset !== null) {
        // Where it points and the shared read-only password come from config, never the row.
        const dataset = demoDatasetFor(row.demoDataset);
        const password = deps.demo?.password();
        if (!dataset || !password) return null;
        return { id: row.id, name: row.name, config: { ...dataset.postgres }, credential: password };
      }
      const signIn = await signInFor(row, userId);
      if (connectionKind(row) !== "key" && !signIn) return null;
      const { type: _type, ...settings } = configOf(row);
      const opened = credentialOf(row, signIn, type);
      return { id: row.id, name: row.name, config: settings, credential: await opened.credential(), updateCredential: opened.updateCredential };
    },

    /**
     * Why a connection didn't open for the caller, in words they can act on:
     * - sign_in_required: it requires sign-in and they haven't (any member may).
     * - nobody_signed_in: a shared sign-in nobody holds now.
     * - guest: they're a guest of the app, and it needs a sign-in guests don't have.
     * Null when it simply isn't theirs to open.
     */
    async whyClosed(
      userId: string,
      connectionId: string,
      { appId }: { appId?: string } = {},
    ): Promise<{ code: "sign_in_required" | "nobody_signed_in" | "guest"; message: string } | null> {
      const found = await find(userId, connectionId);
      if (found) {
        const { row, facts } = found;
        if (facts.connection === "signInEach" && !facts.signedIn) {
          return { code: "sign_in_required", message: `Sign in to ${row.name} to see this. Everyone signs in to it with their own account.` };
        }
        if (facts.connection === "signInShared" && facts.empty) {
          return { code: "nobody_signed_in", message: `Nobody is signed in to ${row.name} now. Ask an admin to sign in to it again.` };
        }
        return null;
      }
      if (!appId || !isUuid(connectionId)) return null;
      const grant = await appAccess(db, userId, appId);
      if (!grant?.guest) return null;
      const [used] = await db
        .select({ id: appConnections.connectionId })
        .from(appConnections)
        .where(and(eq(appConnections.appId, appId), eq(appConnections.connectionId, connectionId)))
        .limit(1);
      return used
        ? { code: "guest", message: "This app's data needs a sign-in that guests don't have. Ask whoever shared it with you." }
        : null;
    },

    /**
     * Whom a shared sign-in runs as, for telling someone else that it
     * expired: only they or an admin can sign in again. Null when it's the
     * caller's own, or not a shared sign-in. The email only for a member of
     * its workspace: a guest isn't told who is in it.
     */
    async signInOwner(userId: string, connectionId: string): Promise<{ name: string; email: string | null } | null> {
      if (!isUuid(connectionId)) return null;
      const [row] = await db
        .select({ name: dataConnections.name, orgId: dataConnections.orgId, holderId: connectionSignIns.userId, email: users.email })
        .from(dataConnections)
        .innerJoin(connectionSignIns, eq(connectionSignIns.connectionId, dataConnections.id))
        .leftJoin(users, eq(users.id, connectionSignIns.userId))
        .where(and(eq(dataConnections.id, connectionId), eq(dataConnections.sharing, "org")))
        .limit(1);
      if (!row || row.holderId === userId) return null;
      return { name: row.name, email: (await roleIn(db, userId, row.orgId)) ? row.email : null };
    },

    /**
     * A connection the caller may sign in to (the policy's connection.signIn):
     * its name, where it points and its workspace, to start a sign-in from.
     */
    async forSignIn(userId: string, connectionId: string): Promise<Result<{ id: string; orgId: string; name: string; config: ConnectionConfig }>> {
      const found = await find(userId, connectionId);
      if (!found || !found.row.orgId || found.row.demoDataset !== null) return notFound();
      const signingIn = decide("connection", "signIn", found.facts);
      if (!signingIn.allowed) return refusal(signingIn);
      return ok({ id: found.row.id, orgId: found.row.orgId, name: found.row.name, config: configOf(found.row) });
    },

    /**
     * The workspace's connection that requires sign-in to this server (an MCP
     * server's URL) or of this source (Google Ads, Meta Ads), if it has one: a
     * second one would only be the same thing under another name, so signing
     * in to it is what someone adding it again means.
     */
    async signInConnectionTo(scope: Scope, target: { url: string } | { type: ConnectionType }): Promise<{ id: string; name: string } | null> {
      if (!(await roleIn(db, scope.userId, scope.orgId))) return null;
      const [row] = await db
        .select({ id: dataConnections.id, name: dataConnections.name })
        .from(dataConnections)
        .where(
          and(
            inWorkspace(scope),
            eq(dataConnections.sharing, "personal"),
            sql`${dataConnections.config} -> 'oauth' is not null`,
            "url" in target ? sql`${dataConnections.config} ->> 'url' = ${target.url}` : eq(dataConnections.type, target.type),
          ),
        )
        .orderBy(asc(dataConnections.createdAt))
        .limit(1);
      return row ?? null;
    },

    /**
     * Keeps a started OAuth sign-in until the browser comes back: the user it
     * belongs to, the connection it will become, and (sealed) the PKCE verifier
     * and client registration. Found later by the state's hash only.
     */
    startSignIn(
      scope: Scope,
      sign: {
        stateHash: string;
        connectionId: string | null;
        name: string;
        config: ConnectionConfig;
        pending: string;
        /** For a new connection: shared with the workspace, or requiring each member's own sign-in. */
        sharing: ConnectionSharing;
      },
    ): Promise<Result<undefined>> {
      return guard("startSignIn", async () => {
        const { userId, orgId } = scope;
        if (sign.connectionId) {
          const existing = await find(userId, sign.connectionId);
          if (!existing) return notFound();
          const signingIn = decide("connection", "signIn", existing.facts);
          if (!signingIn.allowed) return refusal(signingIn);
        } else {
          const creating = decide("connection", "create", await workspaceFacts(db, userId, orgId));
          if (!creating.allowed) return refusal(creating);
          // A connection already here can still be signed in to; only a new one needs the source on offer.
          const unavailable = await refuseNotOffered(scope, sign.config.type);
          if (unavailable) return unavailable;
          // Before sending them off to sign in; checked again when the sign-in is saved.
          const refused = await gate(db, orgId, "createConnection");
          if (refused) return fail(refused);
        }
        const tooLarge = refuseIfTooLarge(sign.config.type, sign.pending, "create");
        if (tooLarge) return tooLarge;
        // Old, abandoned sign-ins go first, with what they hold elsewhere (after the response).
        const expired = await db.delete(mcpOAuthSignIns).where(lt(mcpOAuthSignIns.expiresAt, now())).returning();
        if (expired.length) waitUntil(releasePending(expired));
        const secret = await deps.secrets().seal(sign.pending, signInContext(userId, sign.stateHash));
        await db.insert(mcpOAuthSignIns).values({
          stateHash: sign.stateHash,
          userId,
          orgId,
          connectionId: sign.connectionId,
          sharing: sign.sharing,
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
    ): Promise<{
      orgId: string | null;
      connectionId: string | null;
      sharing: ConnectionSharing;
      name: string;
      config: ConnectionConfig;
      pending: string;
    } | null> {
      const [row] = await db
        .delete(mcpOAuthSignIns)
        .where(and(eq(mcpOAuthSignIns.stateHash, stateHash), eq(mcpOAuthSignIns.userId, userId), gt(mcpOAuthSignIns.expiresAt, now())))
        .returning();
      if (!row) return null;
      const pending = await deps.secrets().open(row.secret, signInContext(userId, stateHash));
      return {
        orgId: row.orgId,
        connectionId: row.connectionId,
        sharing: row.sharing,
        name: row.name,
        config: connectionConfigSchema.parse(row.config),
        pending,
      };
    },

    /**
     * Saves what a finished OAuth sign-in produced, after checking it works:
     * the caller's sign-in to an existing connection (for a shared one, the
     * one everyone runs as from now on), or a new connection with it.
     */
    saveSignedIn(
      userId: string,
      input: {
        orgId: string | null;
        connectionId: string | null;
        sharing: ConnectionSharing;
        name: string;
        config: ConnectionConfig;
        credential: string;
      },
    ): Promise<Result<{ id: string; warnings: ConnectionWarning[] }>> {
      return guard("saveSignedIn", async () => {
        const config = connectionConfigSchema.parse(input.config);
        const source = deps.sources(config.type);
        const tooLarge = refuseIfTooLarge(config.type, input.credential, input.connectionId ? "replace" : "create");
        if (tooLarge) return tooLarge;

        if (input.connectionId) {
          const existing = await find(userId, input.connectionId);
          // Only someone who may sign in to it, finishing what they started: anything else reads as gone.
          if (!existing || !can("connection", "signIn", existing.facts)) return notFound();
          const { row } = existing;
          if (row.type !== config.type || row.demoDataset !== null) return notFound();
          const replaced: ConnectionSignInRow[] = [];
          try {
            const secret = await sealCredential(input.credential, context(config.type, userId, row.id));
            const warnings = await check(config, input.credential);
            await db.transaction(async (tx) => {
              // A shared sign-in has one: whoever signed in last is the one everyone runs as.
              const gone = await tx
                .delete(connectionSignIns)
                .where(
                  row.sharing === "org"
                    ? eq(connectionSignIns.connectionId, row.id)
                    : and(eq(connectionSignIns.connectionId, row.id), eq(connectionSignIns.userId, userId)),
                )
                .returning();
              replaced.push(...gone);
              await tx
                .insert(connectionSignIns)
                .values({ id: randomUUID(), connectionId: row.id, userId, secret, status: "ok", lastCheckedAt: now() });
              await tx.update(dataConnections).set({ config, updatedAt: now() }).where(eq(dataConnections.id, row.id));
            });
            // Committed: the sign-ins it replaced are gone for good.
            await releaseSignIns(config.type, replaced);
            return ok({ id: row.id, warnings });
          } catch (error) {
            return checkFailure(error, config.type);
          } finally {
            for (const { id } of replaced) keyCache.delete(id);
          }
        }

        // Starting it was what needed permission; this only finishes one this user started, in a workspace
        // they're still in.
        if (!input.orgId || !can("workspace", "view", await workspaceFacts(db, userId, input.orgId))) return notFound();
        const id = randomUUID();
        try {
          const secret = await sealCredential(input.credential, context(config.type, userId, id));
          const warnings = await check(config, input.credential);
          const orgId = input.orgId;
          const refused = await insertWithinPlan(orgId, async (tx) => {
            await tx.insert(dataConnections).values({
              id,
              userId,
              orgId: input.orgId,
              sharing: input.sharing,
              name: input.name,
              type: config.type,
              config,
              secret: null,
              credentialHint: source.credential.hint(input.credential),
              status: "ok",
              lastCheckedAt: now(),
            });
            await tx.insert(connectionSignIns).values({ id: randomUUID(), connectionId: id, userId, secret, status: "ok", lastCheckedAt: now() });
          });
          if (refused) return refused;
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
