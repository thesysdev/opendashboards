/*
 * Every page of the app is under its workspace: /w/<workspace id>/…. The
 * address decides which workspace a page is in, so each tab keeps its own,
 * and a form opened in one workspace saves there whatever another tab does.
 */

/** A page of a workspace: its apps, connections or settings. */
export const workspacePath = (orgId: string, page: "apps" | "connections" | "settings" = "apps") => `/w/${orgId}/${page}`;

export const appPath = (orgId: string, appId: string) => `/w/${orgId}/apps/${appId}`;

export const dashboardPath = (orgId: string, appId: string, dashboardId: string) => `/w/${orgId}/apps/${appId}/${dashboardId}`;

/** Where the browser gets its OpenUI Cloud token for one app. */
export const frontendTokenPath = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/frontend-token`;

/** Which workspace, app and dashboard a pathname points at, if any. */
export function parseAppPath(pathname: string | null): { orgId?: string; appId?: string; dashboardId?: string } {
  const workspace = pathname?.match(/^\/w\/([^/]+)/);
  const app = pathname?.match(/^\/w\/[^/]+\/apps\/([^/]+)(?:\/([^/]+))?/);
  return { orgId: workspace?.[1], appId: app?.[1], dashboardId: app?.[2] };
}
