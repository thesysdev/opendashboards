"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { config } from "@/config";
import { DISCOVERY_PROMPT } from "@/components/onboarding/discovery-prompt";
import { track } from "@/lib/analytics";
import { getAppService } from "@/lib/apps";
import { getConnectionService } from "@/lib/connections";
import { fail, type AppResult } from "@/lib/apps/errors";
import { deleteAppDashboardsInCloud, deleteDashboard, getDashboardService, shareDashboardsWithApp } from "@/lib/dashboards";
import { getAppGrant, inWorkspace, memberOf, requireKnownUser } from "@/lib/orgs";
import { decide, refusal } from "@/lib/orgs/policy";
import { appPath, workspacePath } from "@/lib/apps/paths";

/*
 * Public POST endpoints like every Server Action: each authenticates itself,
 * and the service validates input and checks what the user may do in the
 * app's org.
 *
 * Successful changes revalidate the shared layout, not just the page: the
 * sidebar's "Recent" list shows app names too.
 */

const revalidateShell = () => revalidatePath("/", "layout");

/** Creates the app and opens it. Returns only on failure. */
export async function createAppAction(input: unknown): Promise<AppResult<never>> {
  // In the workspace of the page it was sent from.
  const { orgId, fields } = inWorkspace(input);
  const member = await memberOf(orgId);
  if (!member) return fail({ code: "not_found", message: "You aren't a member of this workspace any more. Reload the page." });
  const { user } = member;
  const result = await getAppService().create(member, fields);
  if (!result.ok) return result;
  const { prompt, connectionIds } = fields as { prompt: string; connectionIds: string[] };
  const connections = (await getConnectionService().list(member)).filter((connection) => connectionIds.includes(connection.id));
  track(user.id, "app_created", {
    app_id: result.data.id,
    connection_count: connections.length,
    source_types: [...new Set(connections.map((connection) => connection.type))],
    uses_demo_data: connections.some((connection) => connection.demo),
    prompt_kind:
      prompt.trim() === DISCOVERY_PROMPT
        ? "discovery"
        : config().demoData.datasets.some((dataset) => dataset.prompts.includes(prompt.trim()))
          ? "suggested"
          : "custom",
  }, member.orgId);
  revalidateShell();
  redirect(appPath(member.orgId, result.data.id));
}

export async function renameAppAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const result = await getAppService().rename(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

const teamAccessInput = z.object({ id: z.uuid(), teamAccess: z.enum(["private", "view", "edit"]) }).strict();

/**
 * Sets who else in the workspace can open an app. Before it's opened up, its
 * dashboards are shared with the app's groups in OpenUI Cloud (again if they
 * already were, which changes nothing), so everyone let in can load them.
 */
export async function setAppTeamAccessAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const parsed = teamAccessInput.safeParse(input);
  if (!parsed.success) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const { id, teamAccess } = parsed.data;
  const app = await getAppService().get(user.id, id);
  if (!app) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const sharing = decide("appSharing", "update", app.facts);
  if (!sharing.allowed) return refusal(sharing);
  if (teamAccess !== "private") {
    const shared = await shareDashboardsWithApp(id, app.dashboards.map((dashboard) => dashboard.artifactId));
    if (!shared) {
      return fail({ code: "internal", message: "OpenUI Cloud couldn't share the app's dashboards. Nothing changed. Try again." });
    }
  }
  const result = await getAppService().setTeamAccess(user.id, parsed.data);
  if (result.ok) {
    track(user.id, "app_sharing_changed", { app_id: id, team_access: teamAccess }, app.orgId);
    revalidateShell();
  }
  return result;
}

const guestInput = z.object({ id: z.uuid(), email: z.string().max(300) }).strict();

/**
 * Lets someone outside the workspace view an app, by email. Its dashboards
 * are shared with the app's groups in OpenUI Cloud first (as when it's shared
 * with the workspace), so the guest can load them.
 */
export async function addAppGuestAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const parsed = guestInput.safeParse(input);
  if (!parsed.success) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const app = await getAppService().get(user.id, parsed.data.id);
  if (!app) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const adding = decide("guest", "create", app.facts);
  if (!adding.allowed) return refusal(adding);
  const shared = await shareDashboardsWithApp(app.id, app.dashboards.map((dashboard) => dashboard.artifactId));
  if (!shared) return fail({ code: "internal", message: "OpenUI Cloud couldn't share the app's dashboards. Nothing changed. Try again." });
  const result = await getAppService().addGuest(user.id, parsed.data);
  if (result.ok) {
    // That a guest was added, never who.
    track(user.id, "app_guest_added", { app_id: app.id }, app.orgId);
    revalidateShell();
  }
  return result;
}

/** Takes a guest's access to an app away. For whoever can change the app, and the workspace's admins. */
export async function removeAppGuestAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const result = await getAppService().removeGuest(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

const memberInput = z.object({ id: z.uuid(), memberId: z.string().min(1).max(200), access: z.enum(["view", "edit"]) }).strict();

/**
 * Shares an app with one teammate by name, to view or to edit, or changes
 * what they have. Its dashboards are shared with the app's groups in OpenUI
 * Cloud first (as when it's shared with the workspace), so they can load them.
 */
export async function shareAppWithMemberAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const parsed = memberInput.safeParse(input);
  if (!parsed.success) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const app = await getAppService().get(user.id, parsed.data.id);
  if (!app) return fail({ code: "not_found", message: "This app doesn't exist or was deleted." });
  const sharing = decide("appSharing", "create", app.facts);
  if (!sharing.allowed) return refusal(sharing);
  const shared = await shareDashboardsWithApp(app.id, app.dashboards.map((dashboard) => dashboard.artifactId));
  if (!shared) return fail({ code: "internal", message: "OpenUI Cloud couldn't share the app's dashboards. Nothing changed. Try again." });
  const result = await getAppService().shareWithMember(user.id, parsed.data);
  if (result.ok) {
    // That it was shared with a teammate, never with whom.
    track(user.id, "app_shared_with_member", { app_id: app.id, access: parsed.data.access }, app.orgId);
    revalidateShell();
  }
  return result;
}

/** Takes back what an app gave one teammate by name. For whoever can change the app. */
export async function unshareAppWithMemberAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const result = await getAppService().unshareWithMember(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

/** Adds a connection the user can query to an app. */
export async function addAppConnectionAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const result = await getAppService().addConnection(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

/** Deletes the app and goes back to the list. Returns only on failure. */
export async function deleteAppAction(input: unknown): Promise<AppResult<never>> {
  const user = await requireKnownUser();
  // Its dashboards live in OpenUI Cloud; delete them first so none are left behind.
  const appId = (input as { id?: unknown } | null)?.id;
  // Back to the app's own workspace afterwards.
  const orgId = typeof appId === "string" ? (await getAppGrant(appId))?.orgId : undefined;
  if (typeof appId === "string" && z.uuid().safeParse(appId).success) {
    if (!(await deleteAppDashboardsInCloud(user.id, appId))) {
      return fail({ code: "internal", message: "OpenUI Cloud couldn't delete the app's dashboards. Try again." });
    }
  }
  const result = await getAppService().remove(user.id, input);
  if (!result.ok) return result;
  revalidateShell();
  redirect(orgId ? workspacePath(orgId) : "/apps");
}

/**
 * The prompt the app was created with, taken once so it's sent exactly once:
 * the Build chat sends it as its first message, naming the data sources the
 * user picked.
 */
export async function takePendingPromptAction(appId: string): Promise<string | null> {
  const user = await requireKnownUser();
  const pending = await getAppService().takePendingPrompt(user.id, appId);
  if (!pending) return null;
  const grant = await getAppGrant(appId);
  if (!grant) return pending.prompt;
  const connections = (await getConnectionService().list({ userId: user.id, orgId: grant.orgId })).filter((connection) =>
    pending.connectionIds.includes(connection.id),
  );
  if (!connections.length) return pending.prompt;
  const names = connections.map((connection) => `${connection.name} (${connection.id})`).join(", ");
  return `${pending.prompt}\n\nUse these data sources: ${names}`;
}

const updateDashboardSchema = z
  .object({
    appId: z.uuid(),
    dashboardId: z.uuid(),
    title: z.string().trim().min(1, "Enter a name.").max(120, "Keep the name under 120 characters.").optional(),
    // Empty clears it.
    description: z.string().trim().max(300, "Keep the description under 300 characters.").optional(),
  })
  .strict();

/** Renames one of an app's dashboards, or changes its description. */
export async function updateDashboardAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const parsed = updateDashboardSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return field === "title" || field === "description"
      ? fail({ code: "validation", message: issue!.message, field })
      : fail({ code: "not_found", message: "This dashboard doesn't exist or was deleted." });
  }
  const { appId, dashboardId, title, description } = parsed.data;
  const changes = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description: description || null } : {}),
  };
  if (!(await getDashboardService().update(user.id, appId, dashboardId, changes))) {
    return fail({ code: "not_found", message: "This dashboard doesn't exist or was deleted." });
  }
  revalidateShell();
  return { ok: true, data: undefined };
}

const deleteDashboardSchema = z.object({ appId: z.uuid(), dashboardId: z.uuid() }).strict();

/** Deletes one dashboard of an app, in OpenUI Cloud and in the sidebar. */
export async function deleteDashboardAction(input: unknown): Promise<AppResult> {
  const user = await requireKnownUser();
  const parsed = deleteDashboardSchema.safeParse(input);
  if (!parsed.success) return fail({ code: "not_found", message: "This dashboard doesn't exist or was deleted." });
  const { appId, dashboardId } = parsed.data;

  const dashboard = (await getDashboardService().list(user.id, appId)).find((row) => row.id === dashboardId);
  if (!dashboard) return fail({ code: "not_found", message: "This dashboard doesn't exist or was deleted." });

  const result = await deleteDashboard(user.id, appId, dashboard.artifactId);
  if (!result.ok) {
    return result.reason === "not_found"
      ? fail({ code: "not_found", message: "This dashboard doesn't exist or was deleted." })
      : fail({ code: "internal", message: "OpenUI Cloud couldn't delete the dashboard. Try again." });
  }
  revalidateShell();
  return { ok: true, data: undefined };
}
