/**
 * The Build chat's own AG-UI event (a CUSTOM event, by this name): a create or
 * edit has its dashboard id, and the dashboard is building. It carries OpenUI
 * Cloud's first streamed response for the renderer. The tool call keeps
 * running until the build is saved or fails; its result is the last response.
 */
export const DASHBOARD_STARTED = "opendashboards.dashboard_started";

export type DashboardStarted = {
  toolCallId: string;
  tool: "create_dashboard" | "edit_dashboard";
  response: string;
};
