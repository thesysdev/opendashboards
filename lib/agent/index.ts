import "server-only";

import OpenAI from "openai";
import type { RunnableToolFunctionWithContext } from "openai/lib/RunnableFunction";
import { z } from "zod";

import { artifactOf, getDashboardService, getDashboards, MODEL } from "@/lib/dashboards";
import { logError } from "@/lib/log";
import { ToolError, toolsFor, type ToolContext } from "@/lib/tools";

/**
 * The Build agent: a plain tool loop over OpenUI Gateway. It explores the
 * app's data with every source's agent tools, then creates and edits live
 * dashboards in OpenUI Cloud. The chat itself is Markdown.
 */

export { MODEL };

const GATEWAY_URL = "https://api.thesys.dev/v1/embed";

/** Model rounds per turn, tool calls included. */
export const MAX_ROUNDS = 24;

export const SYSTEM_PROMPT = `You are Prism's dashboard builder. The user is building an app: a set of live dashboards over their own data.

- Explore before you build: find the user's connections with list_connections, look at what data exists, and run queries to check that the numbers you plan to show are real and sensible.
- Build with create_dashboard and change an existing one with edit_dashboard. Describe in the prompt what to show and exactly which tool calls and queries load each part, with the connection id. Dashboards load their data live every time they open.
- Reply in short Markdown. Say what you built and what it shows. Don't paste query results or code unless asked.`;

let gateway: OpenAI | undefined;

/** OpenUI Gateway, with THESYS_API_KEY from the server's environment. */
export function getGateway(): OpenAI {
  gateway ??= new OpenAI({ baseURL: GATEWAY_URL, apiKey: process.env.THESYS_API_KEY });
  return gateway;
}

/** What one turn did, for the route to act on afterwards. */
export type TurnContext = ToolContext & { signal: AbortSignal; dashboards: string[] };

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
  return [...dataTools, createDashboard, editDashboard];
}

function define(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (args: unknown, turn: TurnContext) => Promise<unknown>,
): AgentTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
      parse: (input: string) => JSON.parse(input || "{}") as unknown,
      async function(args: unknown, _runner: unknown, turn: TurnContext) {
        try {
          return await run(args, turn);
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

const createArgs = z.object({
  title: z.string().trim().min(1).max(120).describe("The dashboard's title."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("What the dashboard shows, and which tool calls (with the connection id) load each part."),
});

const createDashboard = define(
  "create_dashboard",
  "Creates a live dashboard in this app. It opens for the user when the turn ends.",
  z.toJSONSchema(createArgs),
  async (input, turn) => {
    const args = parseArgs(createArgs, input);
    const response = await getDashboards().create(args, turn, { signal: turn.signal });
    return remember(response, args.title, turn);
  },
);

const editArgs = z.object({
  dashboard: z.string().min(1).max(200).describe("The dashboard's id, from create_dashboard."),
  prompt: z.string().trim().min(1).max(20_000).describe("What to change."),
});

const editDashboard = define(
  "edit_dashboard",
  "Changes a dashboard in this app, in place.",
  z.toJSONSchema(editArgs),
  async (input, turn) => {
    const args = parseArgs(editArgs, input);
    const dashboard = await getDashboardService().findByArtifact(turn.userId, args.dashboard);
    if (!dashboard || dashboard.appId !== turn.appId) {
      throw new ToolError("dashboard_not_found", `No dashboard ${args.dashboard} in this app.`);
    }
    const response = await getDashboards().edit({ id: args.dashboard, prompt: args.prompt }, turn, {
      signal: turn.signal,
    });
    return remember(response, undefined, turn);
  },
);

/** Records the dashboard against the app, and tells the model its id. */
async function remember(response: string, title: string | undefined, turn: TurnContext) {
  const artifact = artifactOf(response);
  if (!artifact) {
    logError("agent.dashboard", new Error("OpenUI Cloud's response names no artifact"));
    throw new ToolError("no_artifact", "OpenUI Cloud didn't return a dashboard.");
  }
  const name = title ?? artifact.title;
  if (title || artifact.title) {
    const recorded = await getDashboardService().record(turn.userId, turn.appId, {
      artifactId: artifact.id,
      title: name ?? "Dashboard",
    });
    if (!recorded) throw new ToolError("not_found", "This app no longer exists.");
  }
  turn.dashboards.push(artifact.id);
  return { dashboard: artifact.id, title: name, result: response };
}

function parseArgs<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ToolError("bad_args", `Invalid arguments: ${issue?.path.join(".") || "input"}: ${issue?.message}`);
}
