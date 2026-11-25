import "server-only";

import OpenAI from "openai";
import type { RunnableToolFunctionWithContext } from "openai/lib/RunnableFunction";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { config, secrets } from "@/config";
import {
  artifactOf,
  deleteDashboard,
  getDashboardService,
  getDashboards,
  readDashboard,
  shareDashboardsWithApp,
} from "@/lib/dashboards";
import { track } from "@/lib/analytics";
import { logError } from "@/lib/log";
import spec from "@/lib/dashboards/generated/dashboard.spec.json";
import { ToolError, toolsFor, type ToolContext } from "@/lib/tools";

import type { DashboardStarted } from "./events";

/**
 * The Build agent: a plain tool loop over OpenUI Gateway. It explores the
 * app's data with every source's agent tools, then creates and edits live
 * dashboards in OpenUI Cloud. The chat itself is Markdown.
 */



/** Model rounds per turn, tool calls included. */
export const maxRounds = () => config().openui.maxAgentRounds;

/** The model that runs the Build agent. */
export const model = () => config().openui.model;

export const SYSTEM_PROMPT = `You are OpenDashboards' dashboard builder. The user is building an app: a set of live dashboards over their own data.

- Explore before you build: find the user's connections with list_connections, and look at what data exists, so you know what a dashboard can show.
- Build with create_dashboard. To explain or change an existing dashboard, read it first with read_dashboard (find it with list_dashboards), then use edit_dashboard; delete one with delete_dashboard only when the user asks. Dashboards load their data live every time they open.
- If create_dashboard or edit_dashboard fails, say it didn't work and why. Never describe a change that didn't happen.
- If the user's data can't answer what they ask, say so, name the kind of source that could (for example a security log tool), and say they can add it under Data Connections.
- You can't share or publish, but the user can: the Share button at the top of the app adds workspace members, or people outside the workspace by email to view it, and sets whether everyone in the workspace can open it. Point them there when they ask.
- Reply in short Markdown. Say what you built and what it shows. Don't paste query results or code unless asked.`;

let gateway: OpenAI | undefined;

/** OpenUI Gateway, as configured: its URL and the THESYS_API_KEY secret. */
export function getGateway(): OpenAI {
  gateway ??= new OpenAI({ baseURL: config().openui.gatewayUrl, apiKey: secrets.thesysApiKey() });
  return gateway;
}

/** What one turn did, for the route to act on afterwards. */
export type TurnContext = ToolContext & {
  signal: AbortSignal;
  /** Every dashboard this turn created or changed. */
  dashboards: string[];
  /**
   * Tells the chat a create or edit has its dashboard id and is building, with
   * Cloud's first response for the renderer. The call keeps running until its
   * result: the last response.
   */
  onDashboardStarted?: (started: DashboardStarted) => void;
};

type AgentTool = RunnableToolFunctionWithContext<TurnContext>;

/**
 * Every tool the agent may call this turn. A failure goes back to the model
 * as `{ error }`, so it can read it and try again, rather than ending the turn.
 */
export function agentTools(): AgentTool[] {
  const dataTools = toolsFor("agent").map((tool) =>
    define(tool.name, tool.description, tool.parameters, (args, turn) =>
      tool.run(args, turn, { signal: turn.signal, caller: "agent" }),
    ),
  );
  return [...dataTools, listDashboards, readDashboardTool, createDashboard, editDashboard, deleteDashboardTool];
}

/** One call of a tool: its name, the arguments as the model wrote them, and the loop running it. */
type Call = { name: string; input: string; runner: unknown };

function define(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (args: unknown, turn: TurnContext, call: Call) => Promise<unknown>,
): AgentTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
      // The arguments as written travel along, so a tool can find its own call in the loop.
      parse: (input: string) => ({ input, args: JSON.parse(input || "{}") as unknown }),
      async function(parsed: { input: string; args: unknown }, runner: unknown, turn: TurnContext) {
        try {
          return await run(parsed.args, turn, { name, input: parsed.input, runner });
        } catch (error) {
          if (turn.signal.aborted) throw error;
          if (error instanceof ToolError) return { error: { code: error.code, message: error.message } };
          logError(`agent.${name}`, error);
          return { error: { code: "internal", message: "The tool failed unexpectedly." } };
        }
      },
    },
  };
}

/**
 * The id of the tool call running now: in the model's latest message, the
 * call to this tool with these exact arguments. Two identical calls in one
 * round take one id each.
 */
function toolCallIdOf(call: Call, claimed: Set<string>): string | null {
  const messages = (call.runner as { messages?: ChatCompletionMessageParam[] }).messages ?? [];
  const latest = messages.findLast((message) => message.role === "assistant");
  if (latest?.role !== "assistant") return null;
  const match = latest.tool_calls?.find(
    (toolCall) =>
      toolCall.type === "function" &&
      toolCall.function.name === call.name &&
      toolCall.function.arguments === call.input &&
      !claimed.has(toolCall.id),
  );
  if (!match) return null;
  claimed.add(match.id);
  return match.id;
}

const listDashboards = define(
  "list_dashboards",
  "The dashboards already in this app: id and title. Pass an id to edit_dashboard to change one.",
  z.toJSONSchema(z.object({})),
  async (_input, turn) =>
    (await getDashboardService().list(turn.userId, turn.appId)).map(({ artifactId, title }) => ({
      dashboard: artifactId,
      title,
    })),
);

/** Enough for any dashboard so far (10–15K characters), without flooding the context. */
const MAX_PROGRAM_CHARS = 60_000;

const libraryComponents = (spec as unknown as { components: Record<string, { signature: string; description: string }> })
  .components;

/** The dashboard library's own description of each component a program uses. */
function componentsUsed(program: string): Record<string, string> {
  const used: Record<string, string> = {};
  for (const [, name] of program.matchAll(/\b([A-Z][A-Za-z0-9]*)\(/g)) {
    const component = libraryComponents[name];
    if (component && !used[name]) used[name] = component.description;
  }
  return used;
}

const readArgs = z.object({
  dashboard: z.string().min(1).max(200).describe("The dashboard's id, from list_dashboards or create_dashboard."),
});

const readDashboardTool = define(
  "read_dashboard",
  "Reads a dashboard in this app: its program in OpenUI Lang, with every section, component, title and the exact query behind each one, plus what each component draws. Read a dashboard before explaining or changing it.",
  z.toJSONSchema(readArgs),
  async (input, turn) => {
    const args = parseArgs(readArgs, input);
    const result = await readDashboard(turn.userId, turn.appId, args.dashboard);
    if (!result.ok) {
      throw result.reason === "not_found"
        ? new ToolError("dashboard_not_found", `No dashboard ${args.dashboard} in this app.`)
        : new ToolError("cloud_failed", "OpenUI Cloud couldn't read the dashboard. Try again.");
    }
    const truncated = result.program.length > MAX_PROGRAM_CHARS;
    return {
      dashboard: args.dashboard,
      title: result.title,
      description: result.description,
      program: truncated ? result.program.slice(0, MAX_PROGRAM_CHARS) : result.program,
      ...(truncated ? { truncated: true } : {}),
      // What each component it uses draws, e.g. that GeoMap is a map with a ranked list.
      components: componentsUsed(result.program),
    };
  },
);

const createArgs = z.object({
  title: z.string().trim().min(1).max(120).describe("The dashboard's title, shown above it and in the sidebar."),
  description: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("One sentence under the title: what the dashboard shows, over what period or data."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe(
      "What the user wants to see and who it's for, and which connection and data to use. Leave the queries, date ranges and filters to the dashboard builder. " +
        "Leave out its title and description: OpenDashboards draws those above it.",
    ),
});

const createDashboard = define(
  "create_dashboard",
  "Creates a live dashboard in this app, with its title and description, and opens it for the user. " +
    "The dashboard builder calls the connection's tools itself to explore the data, writes and checks the queries, and chooses the layout and filters. " +
    "Returns once the dashboard is saved, or says why it couldn't be built.",
  z.toJSONSchema(createArgs),
  async (input, turn, call) => {
    const args = parseArgs(createArgs, input);
    const build = getDashboards().create({ title: args.title, prompt: args.prompt }, turn, {
      stream: true,
      signal: turn.signal,
    });
    return follow(build, { title: args.title, description: args.description }, turn, call);
  },
);

const editArgs = z.object({
  dashboard: z.string().min(1).max(200).describe("The dashboard's id, from list_dashboards or create_dashboard."),
  prompt: z.string().trim().min(1).max(20_000).describe("What to change."),
});

const editDashboard = define(
  "edit_dashboard",
  "Changes what a dashboard in this app shows, in place. Its title and description stay as they are: the user renames dashboards. " +
    "The dashboard builder calls the connection's tools itself and writes the queries. " +
    "Returns once the change is saved, or says why it couldn't be made.",
  z.toJSONSchema(editArgs),
  async (input, turn, call) => {
    const args = parseArgs(editArgs, input);
    const dashboard = await getDashboardService().findByArtifact(turn.userId, args.dashboard);
    if (!dashboard || dashboard.appId !== turn.appId) {
      throw new ToolError("dashboard_not_found", `No dashboard ${args.dashboard} in this app.`);
    }
    const build = getDashboards().edit({ id: args.dashboard, prompt: args.prompt }, turn, {
      stream: true,
      signal: turn.signal,
    });
    return follow(build, null, turn, call);
  },
);

const deleteArgs = z.object({
  dashboard: z.string().min(1).max(200).describe("The dashboard's id, from list_dashboards or create_dashboard."),
});

const deleteDashboardTool = define(
  "delete_dashboard",
  "Deletes a dashboard from this app, permanently. Use it only when the user asks to delete that dashboard.",
  z.toJSONSchema(deleteArgs),
  async (input, turn) => {
    const args = parseArgs(deleteArgs, input);
    const result = await deleteDashboard(turn.userId, turn.appId, args.dashboard);
    if (!result.ok) {
      throw result.reason === "not_found"
        ? new ToolError("dashboard_not_found", `No dashboard ${args.dashboard} in this app.`)
        : new ToolError("cloud_failed", "OpenUI Cloud couldn't delete the dashboard. Try again.");
    }
    return { deleted: args.dashboard };
  },
);

/** Tool calls of this turn's dashboards that already sent their first result, per turn. */
const claimedCalls = new WeakMap<TurnContext, Set<string>>();

/**
 * Follows a streamed create or edit. OpenUI Cloud sends two messages: the
 * first as soon as the dashboard has an id, the last once it's saved or
 * failed. The first is recorded and goes to the chat at once (not as the
 * tool's result, so the call still shows as running), so the dashboard opens
 * and shows its build steps; the last is the tool result the model reads.
 */
async function follow(
  build: AsyncIterable<string>,
  created: { title: string; description: string } | null,
  turn: TurnContext,
  call: Call,
): Promise<string> {
  let first: string | undefined;
  let last: string | undefined;
  for await (const message of build) {
    if (first === undefined) {
      first = message;
      if (artifactOf(message)) {
        await remember(message, created, turn);
        let claimed = claimedCalls.get(turn);
        if (!claimed) claimedCalls.set(turn, (claimed = new Set()));
        const toolCallId = toolCallIdOf(call, claimed);
        if (toolCallId) {
          turn.onDashboardStarted?.({ toolCallId, tool: call.name as DashboardStarted["tool"], response: message });
        }
      }
    }
    last = message;
  }
  if (first === undefined || last === undefined) {
    logError("agent.dashboard", new Error("OpenUI Cloud's stream had no message"));
    throw new ToolError("no_artifact", "OpenUI Cloud didn't return a dashboard.");
  }
  // Failed before it had an id: Cloud's own sentence says why, for the model to act on.
  if (!artifactOf(first)) throw new ToolError("build_failed", last);
  return last;
}

/**
 * Records a new dashboard against the app with its title and description,
 * and shares it with the app's view and edit groups straight away, so
 * whoever the app lets in can open it the moment it exists. Then returns
 * OpenUI Cloud's response unchanged as the tool result: it names
 * the dashboard (its `artifact_id`) for the model, and the Build chat hands
 * it to the open dashboard's renderer, which follows the new version as it's
 * built. An edit records nothing: the dashboard keeps its title.
 */
async function remember(
  response: string,
  created: { title: string; description: string } | null,
  turn: TurnContext,
) {
  const artifact = artifactOf(response);
  if (!artifact) {
    logError("agent.dashboard", new Error("OpenUI Cloud's response names no artifact"));
    throw new ToolError("no_artifact", "OpenUI Cloud didn't return a dashboard.");
  }
  if (created) {
    const recorded = await getDashboardService().record(turn.userId, turn.appId, { artifactId: artifact.id, ...created });
    if (!recorded) throw new ToolError("not_found", "This app no longer exists.");
    // Whether or not the app is shared yet: the groups only reach people our database lets in.
    // A failure doesn't fail the dashboard; changing anyone's access in Share shares it again.
    if (!(await shareDashboardsWithApp(turn.appId, [artifact.id]))) {
      logError("agent.shareCreated", new Error("A new dashboard wasn't shared with its app's groups"));
    }
  }
  track(turn.userId, created ? "dashboard_created" : "dashboard_updated", { app_id: turn.appId, dashboard_id: artifact.id }, turn.orgId);
  turn.dashboards.push(artifact.id);
  return response;
}

function parseArgs<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ToolError("bad_args", `Invalid arguments: ${issue?.path.join(".") || "input"}: ${issue?.message}`);
}
