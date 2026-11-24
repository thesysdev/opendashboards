import { OpenUIApiError, ToolExecutionError } from "@openuidev/server";
import { z } from "zod";

import { track } from "@/lib/analytics";
import { getDashboardService, getDashboards } from "@/lib/dashboards";
import { cloudIdentity } from "@/lib/dashboards/cloud";
import { SIGN_IN_LOST_HEADER } from "@/lib/dashboards/sign-in-lost";
import { HttpError, readJson, route } from "@/lib/http";
import { addLogContext, logError } from "@/lib/log";

const requestSchema = z.object({
  name: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).optional(),
  id: z.string().min(1).max(200),
  version: z.string().max(200).optional(),
});

/** Total budget for one data call, the dashboard's tools included. */
const TIMEOUT_MS = 120_000;

/**
 * Runs a live dashboard's data calls. The user must be able to open the
 * dashboard's app, and the app and org its tools work in come from
 * OpenDashboards' own record of the dashboard, never from the request.
 */
export const POST = route(async (request, user) => {
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new HttpError(400, "Invalid interpreter request");

  const dashboard = await getDashboardService().findByArtifact(user.id, parsed.data.id);
  if (!dashboard) throw new HttpError(404, "Dashboard not found");
  addLogContext({ app: dashboard.appId, dashboard: parsed.data.id });

  // A data call that finds a sign-in expired says so in a header, even when the
  // dashboard's script caught the error: the page then refreshes to show "Sign in again".
  let signInLost = false;
  const headers = (): HeadersInit => (signInLost ? { [SIGN_IN_LOST_HEADER]: "1" } : {});
  const context = {
    ...cloudIdentity(user.id, dashboard.grant),
    appId: dashboard.appId,
    orgId: dashboard.grant.orgId,
    onSignInLost: () => (signInLost = true),
  };

  try {
    const result = await getDashboards().interpreter.execute(parsed.data, context, { signal: request.signal, timeoutMs: TIMEOUT_MS });
    return Response.json({ result }, { headers: headers() });
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      track(user.id, "dashboard_query_failed", {
        app_id: dashboard.appId,
        dashboard_id: parsed.data.id,
        tool: parsed.data.name,
        error_code: error.code,
      }, dashboard.grant.orgId);
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 400, headers: headers() });
    }
    if (error instanceof OpenUIApiError) {
      logError("interpreter", error);
      return Response.json({ error: { code: "openui_error", message: error.message } }, { status: 502 });
    }
    throw error;
  }
});
