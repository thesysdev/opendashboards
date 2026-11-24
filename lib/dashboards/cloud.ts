import type { AppGrant } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";

/**
 * How OpenDashboards' access to an app is told to OpenUI Cloud.
 *
 * Cloud knows a dashboard's owner (whoever created it) and who it's shared
 * with; it knows nothing of apps, workspaces or roles. So each app has two
 * groups of its own, one to view and one to edit, and every dashboard in a
 * shared app is shared with both, once. Who is "in" a group is decided here,
 * from our database, every time we name a user to Cloud: a token or a server
 * call carries an app's group only if that user may open the app right now.
 *
 * Changing who can open an app therefore never touches Cloud. Our own check
 * applies at once; a token already handed out keeps its group until it
 * expires (15 minutes).
 */

/** The two groups of an app: dashboards are shared with `view` to view and `edit` to edit. */
export const appGroups = (appId: string) => ({ view: `app:${appId}:view`, edit: `app:${appId}:edit` });

/** Who a Cloud call is for: the user, and the one group of the app their access earns them. */
export type CloudIdentity = { userId: string; groupIds: string[] };

/**
 * The identity to give Cloud for a user working in an app. Someone who may
 * change the app gets its edit group; someone who may only view it gets its
 * view group. (An owner whose role is viewer can still only view.)
 */
export function cloudIdentity(userId: string, grant: AppGrant, { viewOnly = false }: { viewOnly?: boolean } = {}): CloudIdentity {
  const groups = appGroups(grant.appId);
  // A view-only workspace (over its plan's limits) can open its dashboards but not change them.
  return { userId, groupIds: [!viewOnly && can("dashboard", "update", grant.facts) ? groups.edit : groups.view] };
}
