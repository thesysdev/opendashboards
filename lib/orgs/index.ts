import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireUser, type CurrentUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";
import type { OrgRole } from "@/lib/db/schema";
import { logError } from "@/lib/log";

import { appAccess, type AppGrant } from "./access";
import { createOrgService, type OrgService, type OrgSummary } from "./service";

export type { AppAccess, AppGrant, Scope } from "./access";
export type { OrgDetail, OrgInvite, OrgMember, OrgSummary } from "./service";

/**
 * The workspace the user was last in. Only where /apps sends them: every page
 * takes its workspace from the address, and membership is checked there.
 */
export const LAST_ORG_COOKIE = "od_org";

/** Where someone with no workspace is sent: the one thing they can do there is create one. */
export const NO_WORKSPACE_PATH = "/welcome";

let service: OrgService | undefined;

export function getOrgService(): OrgService {
  service ??= createOrgService({ db: getDb() });
  return service;
}

/** The signed-in user in one workspace. Passes as a `Scope` to the services. */
export type Member = {
  user: CurrentUser;
  userId: string;
  orgId: string;
  role: OrgRole;
  /** That workspace's name. */
  orgName: string;
  /** Every workspace they're in, the one they've been in longest first. */
  orgs: OrgSummary[];
};

// Per process: who has had rows from before workspaces moved into one.
const adopted = new Set<string>();

/**
 * The signed-in user, recorded. The first time someone is seen, this writes
 * down their email and turns invites waiting for it into memberships.
 * Everything that decides what a person may open matches on that record (a
 * guest by their email, a member by their membership), so call this, never
 * `requireUser`, wherever access is checked: someone's first request is often
 * a link straight to an app. Cached per request; only the first request ever
 * writes. Like `requireUser`, it reads the request, so in a page or layout it
 * must run inside `<Suspense>`.
 */
export const requireKnownUser = cache(async (): Promise<CurrentUser> => {
  const user = await requireUser();
  const service = getOrgService();
  if (!(await service.isKnown(user))) await service.ensureUser(user);
  return user;
});

/** The signed-in user and every workspace they're in. */
const memberships = cache(async (): Promise<{ user: CurrentUser; orgs: OrgSummary[] }> => {
  const user = await requireKnownUser();
  const service = getOrgService();
  const orgs = await service.list(user.id);
  if (orgs.length && !adopted.has(user.id)) {
    adopted.add(user.id);
    await service.adoptOrphans(user.id).catch((error) => {
      adopted.delete(user.id);
      logError("orgs.adoptOrphans", error);
    });
  }
  return { user, orgs };
});

function asMember(user: CurrentUser, orgs: OrgSummary[], open: OrgSummary): Member {
  return { user, userId: user.id, orgId: open.id, role: open.role, orgName: open.name, orgs };
}

/**
 * The signed-in user in the workspace a page's address names, or null when
 * they aren't a member of it. Like `requireUser`, it reads the request, so in
 * a page or layout it must run inside `<Suspense>`.
 */
export const memberOf = cache(async (orgId: unknown): Promise<Member | null> => {
  const { user, orgs } = await memberships();
  const open = orgs.find((org) => org.id === orgId);
  return open ? asMember(user, orgs, open) : null;
});

/** As `memberOf`, for a page: anyone who isn't a member gets the not-found page. */
export async function requireMemberOf(orgId: string): Promise<Member> {
  return (await memberOf(orgId)) ?? notFound();
}

/**
 * The signed-in user in the workspace they were last in, if they're still a
 * member of it, otherwise the one they've been in longest. Null when they're
 * in none. Only for deciding where to send them: a page uses its own address.
 */
export const lastMember = cache(async (): Promise<Member | null> => {
  const { user, orgs } = await memberships();
  if (!orgs.length) return null;
  const last = (await cookies()).get(LAST_ORG_COOKIE)?.value;
  return asMember(user, orgs, orgs.find((org) => org.id === last) ?? orgs[0]);
});

/**
 * What a form that creates something sends: the workspace of the page it's
 * on, and its own fields. The workspace is checked by `memberOf`; the fields
 * by the service's own schema.
 */
export function inWorkspace(input: unknown): { orgId: unknown; fields: unknown } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { orgId: undefined, fields: input };
  const { orgId, ...fields } = input as Record<string, unknown>;
  return { orgId, fields };
}

/** What the signed-in user may do with an app, or null. Cached per request. */
export const getAppGrant = cache(async (appId: string): Promise<AppGrant | null> => {
  const user = await requireKnownUser();
  return appAccess(getDb(), user.id, appId);
});
