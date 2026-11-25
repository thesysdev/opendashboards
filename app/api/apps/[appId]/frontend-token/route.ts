import { getOpenUI } from "@/lib/dashboards";
import { cloudIdentity } from "@/lib/dashboards/cloud";
import { getDb } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { appAccess } from "@/lib/orgs/access";
import { getGate } from "@/lib/plans";

type Ctx = { params: Promise<{ appId: string }> };

/**
 * The signed-in user's OpenUI Cloud frontend token for one app: the browser
 * reads their chat threads and the app's dashboards with it. It carries the
 * app's view or edit group only if they may open the app right now, so it
 * reaches the dashboards teammates made in it, and nothing of any other app.
 */
export const POST = route<Ctx>(async (_request, user, { params }) => {
  const { appId } = await params;
  const grant = await appAccess(getDb(), user.id, appId);
  if (!grant) throw new HttpError(404, "App not found");
  const viewOnly = (await getGate()(getDb(), grant.orgId, "editDashboard")) !== null;
  return Response.json(await getOpenUI().createFrontendToken(cloudIdentity(user.id, grant, { viewOnly })));
});
