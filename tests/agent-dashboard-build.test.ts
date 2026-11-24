import { EventType, type BaseEvent } from "@ag-ui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for OpenUI Cloud's streamed build: the messages it yields, in order. */
let messages: string[] = [];
const record = vi.fn(async () => ({ id: "row" }));
const share = vi.fn(async () => true);

vi.mock("@/lib/dashboards", () => ({
  // Cloud's real messages carry a content line; here a message names its dashboard as "id=…".
  artifactOf: (response: string) => {
    const id = /id=(\S+)/.exec(response)?.[1];
    return id ? { id } : null;
  },
  getDashboards: () => ({
    create: (_params: unknown, _context: unknown, options: { stream?: boolean }) => {
      expect(options.stream).toBe(true);
      return (async function* () {
        yield* messages;
      })();
    },
  }),
  getDashboardService: () => ({ record }),
  shareDashboardsWithApp: share,
  deleteDashboard: vi.fn(),
  readDashboard: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { agentTools } = await import("@/lib/agent");
const { createAgUiTranslator } = await import("@/lib/agent/ag-ui");

const input = JSON.stringify({ title: "Orders", description: "Orders by day.", prompt: "Orders by day from pg." });

/** Runs create_dashboard as the tool loop does, with the model's latest message holding the given calls. */
async function runCreate(toolCallIds = ["call_1"]) {
  const tool = agentTools().find((candidate) => candidate.function.name === "create_dashboard")!;
  const sent: [string, string][] = [];
  const turn = {
    userId: "u",
    appId: "a",
    orgId: "o",
    groupIds: [],
    signal: new AbortController().signal,
    dashboards: [] as string[],
    sendToolResult: (toolCallId: string, content: string) => sent.push([toolCallId, content]),
  };
  const runner = {
    messages: [
      { role: "user", content: "Build it" },
      {
        role: "assistant",
        content: null,
        tool_calls: toolCallIds.map((id) => ({ id, type: "function", function: { name: "create_dashboard", arguments: input } })),
      },
    ],
  };
  const fn = tool.function as unknown as {
    parse: (raw: string) => unknown;
    function: (parsed: unknown, runner: unknown, turn: unknown) => Promise<unknown>;
  };
  const run = () => fn.function(fn.parse(input), runner, turn);
  return { run, sent, turn };
}

beforeEach(() => {
  record.mockClear();
  share.mockClear();
});

describe("create_dashboard, streamed", () => {
  it("sends the first message to the chat at once and returns the last", async () => {
    messages = ["Started Orders. id=art_1", "Created Orders. id=art_1"];
    const { run, sent, turn } = await runCreate();
    await expect(run()).resolves.toBe("Created Orders. id=art_1");
    expect(sent).toEqual([["call_1", "Started Orders. id=art_1"]]);
    expect(record).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith("a", ["art_1"]);
    expect(turn.dashboards).toEqual(["art_1"]);
  });

  it("returns a build that failed after it started, for the model to read", async () => {
    messages = ["Started Orders. id=art_1", "Couldn't build Orders: the query failed. id=art_1"];
    const { run } = await runCreate();
    await expect(run()).resolves.toBe("Couldn't build Orders: the query failed. id=art_1");
  });

  it("reports Cloud's own reason when the build never got an id", async () => {
    messages = ["Couldn't start: the prompt is empty."];
    const { run, sent } = await runCreate();
    await expect(run()).resolves.toEqual({ error: { code: "build_failed", message: "Couldn't start: the prompt is empty." } });
    expect(sent).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("gives two identical calls in one round one id each", async () => {
    messages = ["Started Orders. id=art_1", "Created Orders. id=art_1"];
    const { run, sent } = await runCreate(["call_1", "call_2"]);
    await run();
    await run();
    expect(sent.map(([id]) => id)).toEqual(["call_1", "call_2"]);
  });
});

describe("the AG-UI translator", () => {
  it("sends an early result and the loop's own for the same call", () => {
    const events: BaseEvent[] = [];
    const translate = createAgUiTranslator((event) => events.push(event));
    translate.result("call_1", "Started");
    translate.message({ role: "tool", tool_call_id: "call_1", content: "Created" });
    expect(events.map((event) => [event.type, (event as unknown as { toolCallId: string }).toolCallId])).toEqual([
      [EventType.TOOL_CALL_RESULT, "call_1"],
      [EventType.TOOL_CALL_RESULT, "call_1"],
    ]);
  });
});
