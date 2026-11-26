"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { config } from "@/config";
import { identifyWorkspace, track } from "@/lib/analytics";
import { DEV_USER_COOKIE, DEV_USER_NAMES } from "@/lib/auth/providers/dev";
import { deleteDashboardsInCloud } from "@/lib/dashboards";
import { getDb } from "@/lib/db";
import { workspacePath } from "@/lib/apps/paths";
import { getOrgService, LAST_ORG_COOKIE, requireKnownUser } from "@/lib/orgs";
import { roleIn } from "@/lib/orgs/access";
import { fail, type OrgResult } from "@/lib/orgs/errors";
import { logError } from "@/lib/log";
import { getPlans } from "@/lib/plans";
import { z } from "zod";

/*
 * Public POST endpoints like every Server Action: each authenticates itself,
 * and the service checks the caller's own role in the workspace before any change.
 */

const revalidateShell = () => revalidatePath("/", "layout");

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Notes a workspace as the one /apps opens next time. */
async function rememberOrg(orgId: string) {
  (await cookies()).set(LAST_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: YEAR_SECONDS,
    secure: config().env !== "local",
  });
}

/**
 * Notes the workspace on screen as the one /apps opens next time. Only a
 * preference: a page takes its workspace from its address, and /apps checks
 * membership again.
 */
export async function rememberWorkspaceAction(orgId: unknown): Promise<void> {
  const user = await requireKnownUser();
  if (typeof orgId === "string" && (await roleIn(getDb(), user.id, orgId))) await rememberOrg(orgId);
}

/**
 * Creates a workspace. The caller opens it at its address. Each person gets
 * one Free workspace: someone who already created one is told a new one
 * starts on a paid plan (`plan_limit`), and pays with `checkoutWorkspaceAction`.
 */
export async function createOrgAction(input: unknown): Promise<OrgResult<{ id: string }>> {
  const user = await requireKnownUser();
  const plans = getPlans();
  if (plans && !(await plans.mayCreateFree(user.id))) {
    // No workspace yet, so no group: the person's own event.
    track(user.id, "plan_limit_hit", { plan_id: config().plans?.free ?? null, limit: "new_workspace", operation: "createWorkspace", surface: "settings" }, null);
    return fail({ code: "plan_limit", message: "You already have a Free workspace, so a new one starts on a paid plan." });
  }
  const result = await getOrgService().create(user, input);
  if (!result.ok) return result;
  await rememberOrg(result.data.id);
  identifyWorkspace(result.data.id);
  track(user.id, "workspace_created", { org_id: result.data.id, first: false }, result.data.id);
  revalidateShell();
  return result;
}

/**
 * For someone in no workspace: creates one named after them, in one click,
 * and takes them into the app. Returns only on failure.
 */
export async function createFirstWorkspaceAction(): Promise<OrgResult<never>> {
  const user = await requireKnownUser();
  const result = await getOrgService().create(user);
  if (!result.ok) return result;
  await rememberOrg(result.data.id);
  identifyWorkspace(result.data.id);
  track(user.id, "workspace_created", { org_id: result.data.id, first: true }, result.data.id);
  revalidateShell();
  redirect(workspacePath(result.data.id));
}

const paidWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60, "Keep the name under 60 characters."),
  planId: z.string().min(1).max(40),
  interval: z.enum(["month", "year"]),
});

/** The plans a new workspace can be bought on, cheapest first. None when billing is off. */
export async function paidPlansAction(): Promise<{ id: string; name: string }[]> {
  await requireKnownUser();
  const settings = config().plans;
  if (!settings) return [];
  return Object.entries(settings.catalog).flatMap(([id, plan]) => (plan.stripe ? [{ id, name: plan.name }] : []));
}

/** Stripe Checkout for a new workspace on a paid plan. It's created once the checkout is paid. */
export async function checkoutWorkspaceAction(input: unknown): Promise<OrgResult<{ url: string }>> {
  const user = await requireKnownUser();
  const plans = getPlans();
  const parsed = paidWorkspaceSchema.safeParse(input);
  if (!plans) return fail({ code: "not_found", message: "Billing isn't available." });
  if (!parsed.success) return fail({ code: "validation", field: "name", message: parsed.error.issues[0]?.message ?? "Check the form." });
  try {
    const started = await plans.checkoutNewWorkspace({ userId: user.id, ...parsed.data, cancelPath: "/apps" });
    return started.ok ? { ok: true, data: { url: started.url } } : fail({ code: "validation", message: started.message });
  } catch (error) {
    logError("billing.newWorkspace", error);
    return fail({ code: "internal", message: "Stripe couldn't start this. Try again, or email support@thesys.dev." });
  }
}

export async function renameOrgAction(input: unknown): Promise<OrgResult> {
  const user = await requireKnownUser();
  const result = await getOrgService().rename(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

/** The workspace an action was for. Read only after the service accepted it, so it's one the user is in. */
const orgOf = (input: unknown): string | null => {
  const orgId = (input as { orgId?: unknown } | null)?.orgId;
  return typeof orgId === "string" ? orgId : null;
};

export async function inviteMemberAction(input: unknown): Promise<OrgResult<{ status: "added" | "invited" }>> {
  const user = await requireKnownUser();
  const result = await getOrgService().invite(user.id, input);
  if (result.ok) {
    // The role and whether they already had an account: never the email.
    track(user.id, "workspace_member_invited", { status: result.data.status, role: (input as { role?: unknown } | null)?.role ?? null }, orgOf(input));
    revalidateShell();
  }
  return result;
}

export async function revokeInviteAction(input: unknown): Promise<OrgResult> {
  const user = await requireKnownUser();
  const result = await getOrgService().revokeInvite(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

export async function changeMemberRoleAction(input: unknown): Promise<OrgResult> {
  const user = await requireKnownUser();
  const result = await getOrgService().changeRole(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

/**
 * Ends someone's membership, removed by an admin or leaving on their own, the
 * same way: their dashboards are deleted in OpenUI Cloud first, so none are
 * left behind, then their apps, sign-ins and the rest (OrgService `depart`).
 * If Cloud can't delete them, nothing changes.
 */
async function departWithCloud(
  userId: string,
  departure: { orgId: unknown; userId: unknown },
  end: () => Promise<OrgResult>,
): Promise<OrgResult<{ dashboards: number }>> {
  const plan = await getOrgService().dashboardsToDeleteOnDeparture(userId, departure);
  if (!plan.ok) return plan;
  if (!(await deleteDashboardsInCloud(plan.data.artifactIds))) {
    return fail({ code: "internal", message: "OpenUI Cloud couldn't delete some of the dashboards. Nothing changed. Try again." });
  }
  const result = await end();
  return result.ok ? { ok: true, data: { dashboards: plan.data.artifactIds.length } } : result;
}

/** Removes someone from a workspace, with every app they own in it. */
export async function removeMemberAction(input: unknown): Promise<OrgResult> {
  const user = await requireKnownUser();
  const departure = input as { orgId?: unknown; userId?: unknown } | null;
  const result = await departWithCloud(user.id, { orgId: departure?.orgId, userId: departure?.userId }, () =>
    getOrgService().removeMember(user.id, input),
  );
  if (!result.ok) return result;
  track(user.id, "workspace_member_removed", { dashboards_deleted: result.data.dashboards }, orgOf(input));
  revalidateShell();
  return { ok: true, data: undefined };
}

/**
 * Leaves a workspace, with every app you own in it. Whichever of your others
 * opens next; with none left, you're asked to create one.
 */
export async function leaveOrgAction(input: unknown): Promise<OrgResult> {
  const user = await requireKnownUser();
  const orgId = (input as { orgId?: unknown } | null)?.orgId;
  const result = await departWithCloud(user.id, { orgId, userId: user.id }, () => getOrgService().leave(user.id, input));
  if (!result.ok) return result;
  track(user.id, "workspace_left", { dashboards_deleted: result.data.dashboards }, orgOf(input));
  (await cookies()).delete(LAST_ORG_COOKIE);
  revalidateShell();
  return { ok: true, data: undefined };
}

/**
 * Deletes a workspace and everything in it, for every member. Admins only,
 * with its name retyped. Its dashboards are deleted in OpenUI Cloud first, so
 * none are left behind; then the rest. Returns only on failure.
 */
export async function deleteOrgAction(input: unknown): Promise<OrgResult<never>> {
  const user = await requireKnownUser();
  const orgs = getOrgService();
  const plan = await orgs.dashboardsToDelete(user.id, input);
  if (!plan.ok) return plan;
  // A paid plan ends now: there'll be nothing left to bill.
  const billing = getPlans()?.billing;
  const orgId = orgOf(input);
  if (billing && orgId) {
    try {
      await billing.cancelNow(orgId);
    } catch (error) {
      logError("billing.cancelOnDelete", error);
      return fail({ code: "internal", message: "Stripe couldn't cancel the workspace's plan. Nothing was deleted. Try again." });
    }
  }
  if (!(await deleteDashboardsInCloud(plan.data.artifactIds))) {
    return fail({ code: "internal", message: "OpenUI Cloud couldn't delete some of the workspace's dashboards. Nothing else was deleted. Try again." });
  }
  const result = await orgs.remove(user.id, input);
  if (!result.ok) return result;
  track(user.id, "workspace_deleted", { dashboards: plan.data.artifactIds.length }, orgOf(input));
  (await cookies()).delete(LAST_ORG_COOKIE);
  revalidateShell();
  // Another of their workspaces opens; with none left, they're asked to create one.
  redirect("/apps");
}

/**
 * Local development only: acts as a stand-in person (or, with null, the
 * configured dev user again), to try workspaces with more than one member.
 * Anywhere else it does nothing: only the dev sign-in reads this cookie.
 */
export async function switchDevUserAction(name: unknown): Promise<void> {
  if (config().env !== "local") return;
  const store = await cookies();
  if (typeof name === "string" && (DEV_USER_NAMES as readonly string[]).includes(name)) {
    store.set(DEV_USER_COOKIE, name, { httpOnly: true, sameSite: "lax", path: "/" });
  } else {
    store.delete(DEV_USER_COOKIE);
  }
  // A different person has a different org open.
  store.delete(LAST_ORG_COOKIE);
  revalidateShell();
}
