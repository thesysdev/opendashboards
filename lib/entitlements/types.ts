/*
 * What a workspace may have, by name. Plain types and values, no server code:
 * config and the browser read them too. Which plan grants what is decided
 * elsewhere (lib/plans); this module only knows the names and their shapes.
 */

/** A count a workspace may have: up to `max`, or unlimited (null). */
export type Limit = { max: number | null };

/** A feature a workspace has or doesn't. */
export type Switch = { on: boolean };

/** Everything a plan grants. Each name has exactly one type. */
export type Entitlements = {
  /** Admins and editors, plus admin or editor invites not yet accepted. */
  editors: Limit;
  /** Connections, sample data not counted. */
  connections: Limit;
  /** Apps, private ones included. */
  apps: Limit;
  /** Members may be viewers. */
  viewerRole: Switch;
};

export type LimitName = { [K in keyof Entitlements]: Entitlements[K] extends Limit ? K : never }[keyof Entitlements];
export type SwitchName = { [K in keyof Entitlements]: Entitlements[K] extends Switch ? K : never }[keyof Entitlements];

/** Everything allowed: what a workspace has when billing is off (self-hosted, local). */
export const UNLIMITED: Entitlements = {
  editors: { max: null },
  connections: { max: null },
  apps: { max: null },
  viewerRole: { on: true },
};

/** Each limit with how much of it is used, for pages: "Apps 4 of 5". */
export type Limits = Record<LimitName, { used: number; max: number | null }>;

/** Whether usage is over any limit: the workspace is then view-only. */
export const isViewOnly = (limits: Limits): boolean => Object.values(limits).some(({ used, max }) => max !== null && used > max);
