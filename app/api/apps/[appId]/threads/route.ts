import { getThreadService } from "@/lib/apps";
import { readJson, respond, route } from "@/lib/http";

type Ctx = { params: Promise<{ appId: string }> };

/** The app's chat threads, newest activity first. `?cursor=` pages. */
export const GET = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor");
  return respond(await getThreadService().list(user.id, appId, cursor));
});

/** Registers a thread just created in OpenUI Cloud as belonging to the app. */
export const POST = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  return respond(await getThreadService().register(user.id, appId, await readJson(request)));
});
