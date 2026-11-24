import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { apps, dataConnections, orgInvites, orgMembers } from "@/lib/db/schema";

import { isViewOnly, UNLIMITED, type Entitlements, type LimitName, type Limits, type SwitchName } from "./types";

export * from "./types";

/*
 * Enforcement: what a workspace may do, from its entitlements and its usage.
 * It knows nothing of plans, prices or billing: it's handed `entitlementsFor`
 * and, without one, allows everything.
 */

/** The database, or a transaction on it. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What a gated operation requires. */
type Requirement =
  | { adds: LimitName } // one more of a limited thing; also refused while view-only
  | { needs: SwitchName } // a switched-on feature
  // The workspace must not be view-only. A workspace is view-only while its usage is over
  // a limit, which can only happen after it moves to the free plan with more than that plan
  // allows: a cancel taking effect at period end, or a failed payment ending the subscription.
  | { viewOnlyWorkspace: false };

/** Every gated operation, and what it requires. The only place that links operations to entitlements. */
export const OPERATIONS = {
  createApp: { adds: "apps" },
  createConnection: { adds: "connections" }, // a new connection; not sample data, not signing in to one it has
  addEditor: { adds: "editors" }, // invite, or raise a viewer, to admin or editor
  addViewer: { needs: "viewerRole" }, // invite as, or change to, viewer
  chat: { viewOnlyWorkspace: false },
  renameApp: { viewOnlyWorkspace: false },
  editDashboard: { viewOnlyWorkspace: false },
  renameConnection: { viewOnlyWorkspace: false },
  addAppConnection: { viewOnlyWorkspace: false },
} as const satisfies Record<string, Requirement>;

export type Operation = keyof typeof OPERATIONS;

/** Why an operation was refused: data only, no wording, no plan names. */
export type Denial =
  | { reason: "limit"; name: LimitName; max: number }
  | { reason: "switchedOff"; name: SwitchName }
  | { reason: "viewOnly"; over: { name: LimitName; usage: number; max: number }[] };

export type Verdict = { ok: true } | { ok: false; denial: Denial };

const BUILDERS = ["admin", "editor"] as const;

/** How much of each limit a workspace uses. A counter for every LimitName, or it doesn't compile. */
export const USAGE: { [K in LimitName]: (db: Executor, orgId: string) => Promise<number> } = {
  async editors(db, orgId) {
    const [members] = await db
      .select({ n: count() })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), inArray(orgMembers.role, BUILDERS)));
    // An invite holds its seat until it's accepted or revoked.
    const [invites] = await db
      .select({ n: count() })
      .from(orgInvites)
      .where(and(eq(orgInvites.orgId, orgId), inArray(orgInvites.role, BUILDERS)));
    return (members?.n ?? 0) + (invites?.n ?? 0);
  },
  async connections(db, orgId) {
    // One row per source: members each signing in to a connection that requires sign-in are
    // sign-ins of that one connection, so they count once. Sample data is for trying the product.
    const [row] = await db
      .select({ n: count() })
      .from(dataConnections)
      .where(and(eq(dataConnections.orgId, orgId), isNull(dataConnections.demoDataset)));
    return row?.n ?? 0;
  },
  async apps(db, orgId) {
    const [row] = await db.select({ n: count() }).from(apps).where(eq(apps.orgId, orgId));
    return row?.n ?? 0;
  },
};

const LIMIT_NAMES = Object.keys(USAGE) as LimitName[];

export type Enforcement = {
  /**
   * Whether a workspace may do something now. It takes a per-workspace lock
   * for the rest of the transaction, so two adds can't both pass at the
   * limit: call it in the same transaction as the insert.
   */
  enforce(db: Executor, orgId: string, operation: Operation): Promise<Verdict>;
  /** Each limit with its usage, for pages. max null = unlimited. */
  getLimits(db: Executor, orgId: string): Promise<Limits>;
};

export function createEnforcement({
  entitlementsFor = async () => UNLIMITED,
}: { entitlementsFor?: (orgId: string) => Promise<Entitlements> } = {}): Enforcement {
  async function getLimits(db: Executor, orgId: string): Promise<Limits> {
    const entitlements = await entitlementsFor(orgId);
    // One after another: a transaction is one connection, which runs one query at a time.
    const limits = {} as Limits;
    for (const name of LIMIT_NAMES) limits[name] = { used: await USAGE[name](db, orgId), max: entitlements[name].max };
    return limits;
  }

  return {
    getLimits,
    async enforce(db, orgId, operation) {
      const requirement: Requirement = OPERATIONS[operation];
      if ("needs" in requirement) {
        const entitlements = await entitlementsFor(orgId);
        return entitlements[requirement.needs].on ? { ok: true } : { ok: false, denial: { reason: "switchedOff", name: requirement.needs } };
      }
      // Serializes checks on one workspace until the transaction ends (outside one, until this statement does).
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`entitlements:${orgId}`}))`);
      const limits = await getLimits(db, orgId);
      if (isViewOnly(limits)) {
        const over = LIMIT_NAMES.flatMap((name) => {
          const { used, max } = limits[name];
          return max !== null && used > max ? [{ name, usage: used, max }] : [];
        });
        return { ok: false, denial: { reason: "viewOnly", over } };
      }
      if ("adds" in requirement) {
        const { used, max } = limits[requirement.adds];
        if (max !== null && used >= max) return { ok: false, denial: { reason: "limit", name: requirement.adds, max } };
      }
      return { ok: true };
    },
  };
}

/** What a refused operation tells the person, worded by whoever knows the plans. */
export type Refusal = { code: "plan_limit"; message: string };

/**
 * What the services call before a gated operation: null to go ahead, or what
 * to tell the person. Built by lib/plans; `OPEN_GATE` when billing is off.
 */
export type Gate = (db: Executor, orgId: string, operation: Operation) => Promise<Refusal | null>;

export const OPEN_GATE: Gate = async () => null;
