import type { ArtifactStorage } from "@openuidev/react-headless";

import { DASHBOARD_STARTED, type DashboardStarted } from "@/lib/agent/events";

/*
 * Build lab (development only, NEXT_PUBLIC_BUILD_LAB=1): replays a dashboard build through the
 * app's real chat and real dashboard area, so states a live build can't be made to reach on
 * demand (no tool calls, a tool no source owns, a failure) can be looked at again and again.
 *
 * It scripts the two things a real build produces, and nothing else:
 *   - the chat's reply (AG-UI events: the tool call, the route's "dashboard started" event with
 *     the dashboard's id, the call's result, a sentence), in place of POST /api/apps/:id/chat;
 *   - the dashboard's stream from OpenUI Cloud (reference, `step` events, the program in pieces,
 *     end or error), in place of GET /v1/artifacts/:id/stream.
 * The program replayed is a real dashboard of this app, read from Cloud, and its queries run for
 * real. Everything on screen is the app's own code reacting to those events. A replayed new
 * dashboard isn't recorded by the server, so it never gets a page of its own: the move to the
 * new dashboard's page is only ever seen in a live build.
 */

export const LAB_ENABLED = process.env.NEXT_PUBLIC_BUILD_LAB === "1";

/** One round of the dashboard agent's calls, as Cloud's `step` event names it. */
type Round = { tools: string[]; scripts?: string[] };

export type Scenario = {
  id: string;
  label: string;
  hint: string;
  kind: "create" | "edit" | "fail";
  prompt: string;
  rounds: Round[];
};

export const SCENARIOS: Scenario[] = [
  {
    id: "typical",
    label: "Typical build",
    hint: "3 rounds on one database",
    kind: "create",
    prompt: "Build a sales overview from our Postgres database",
    rounds: [
      { tools: ["postgres_tables"] },
      { tools: ["postgres_query", "postgres_query"], scripts: ["revenue_by_month", "orders_by_status"] },
      { tools: ["postgres_query"], scripts: ["top_customers"] },
    ],
  },
  {
    id: "no-tools",
    label: "No tool calls",
    hint: "Thinking, then straight to building",
    kind: "create",
    prompt: "Build a dashboard from what you already know",
    rounds: [],
  },
  {
    id: "sources",
    label: "Many sources",
    hint: "every connector's logo",
    kind: "create",
    prompt: "Build a growth dashboard across product, marketing and billing",
    rounds: [
      { tools: ["posthog_event_names", "ga4_fields", "postgres_tables"] },
      { tools: ["posthog_query", "ga4_report", "searchconsole_query"] },
      { tools: ["bigquery_query", "clickhouse_query", "mysql_query"], scripts: ["signups_to_paid_funnel"] },
    ],
  },
  {
    id: "unknown",
    label: "Unknown connector",
    hint: "custom and MCP tools: the generic icon",
    kind: "create",
    prompt: "Build a dashboard from our internal API",
    rounds: [{ tools: ["fetch_rows_v2"] }, { tools: ["mcp_call", "agg_internal"] }, { tools: ["join_cache_lookup"], scripts: ["weekly_rollup"] }],
  },
  {
    id: "fail",
    label: "Build fails",
    hint: "stops after two rounds",
    kind: "fail",
    prompt: "Build a dashboard from the broken source",
    rounds: [{ tools: ["postgres_tables"] }, { tools: ["postgres_query"] }],
  },
  {
    id: "edit",
    label: "Edit a dashboard",
    hint: "the one on screen stays readable",
    kind: "edit",
    prompt: "Add a breakdown by region to this dashboard",
    rounds: [{ tools: ["postgres_tables"] }, { tools: ["postgres_query"], scripts: ["revenue_by_region"] }],
  },
];

export type LabState = {
  scenario: string;
  running: boolean;
  /** Advances on its own; off, it waits before each step for "Next". */
  auto: boolean;
  speed: number;
  /** What the run is on, in words. */
  stage: string | null;
  error: string | null;
};

/** The real dashboard a run replays: read from Cloud once. */
type Recording = { id: string; version: string; title: string; program: string };

type Beat = {
  stage: string;
  /** Milliseconds before it runs, at 1x. */
  wait: number;
  /** Runs right after the beat before it even when stepping: the pieces of one stage. */
  flow?: boolean;
  run: () => void;
};

type SseEvent = { event: string; data: unknown };

const FAILURE = "Couldn't build the dashboard: a data source stopped answering.";

const encoder = new TextEncoder();

class LabController {
  private state: LabState = { scenario: "typical", running: false, auto: true, speed: 1, stage: null, error: null };
  private listeners = new Set<() => void>();

  // ── One run ──
  private run = 0;
  private beats: Beat[] = [];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recording: Recording | null = null;
  /** The id the dashboard's stream goes by this run: an alias for a new dashboard, the real id for an edit. */
  private streamId: string | null = null;
  private streamVersion = "";
  private artifactLog: SseEvent[] = [];
  private artifactListeners = new Set<(event: SseEvent | null) => void>();
  private artifactOpen = false;
  private chat: ReadableStreamDefaultController<Uint8Array> | null = null;
  private recordings = new Map<string, Recording>();

  /** A run is laid out and waiting for the chat message that starts it. */
  armed = false;

  // ── State for React ──
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = (): LabState => this.state;
  private set(patch: Partial<LabState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  setScenario(scenario: string) {
    this.set({ scenario });
  }
  setSpeed(speed: number) {
    this.set({ speed });
  }
  setAuto(auto: boolean) {
    this.set({ auto });
    if (auto) this.schedule();
    else if (this.timer && !this.beats[this.index]?.flow) this.clearTimer();
  }

  get scenario(): Scenario {
    return SCENARIOS.find((scenario) => scenario.id === this.state.scenario) ?? SCENARIOS[0];
  }

  // ── Preparing a run ──

  /** Reads the dashboard to replay and lays out the run. Call before sending the chat message. */
  async prepare(artifactId: string, storage: ArtifactStorage): Promise<boolean> {
    this.stop();
    try {
      this.recording = await this.record(artifactId, storage);
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : "Couldn't read that dashboard." });
      return false;
    }
    const scenario = this.scenario;
    this.run += 1;
    this.streamId = scenario.kind === "edit" ? this.recording.id : `art_lab_${Date.now().toString(36)}_${this.run}`;
    this.streamVersion = `lab-${this.run}`;
    this.artifactLog = [];
    this.artifactOpen = true;
    this.beats = this.script(scenario, this.recording);
    this.index = 0;
    this.armed = true;
    this.set({ stage: null, running: true, error: null });
    return true;
  }

  /** The dashboard as Cloud has it now, read through the app's own storage (its token, its API). */
  private async record(artifactId: string, storage: ArtifactStorage): Promise<Recording> {
    const cached = this.recordings.get(artifactId);
    if (cached) return cached;
    if (!storage.stream) throw new Error("This storage can't stream a dashboard to replay.");
    let version = "";
    let title = "Dashboard";
    let program = "";
    for await (const event of storage.stream(artifactId, {})) {
      if (event.type === "reference") {
        version = event.data?.version ?? "";
        title = event.data?.title ?? title;
      } else if (event.type === "delta") program += event.data?.text ?? "";
      else if (event.type === "end" || event.type === "error") break;
    }
    if (!program) throw new Error("That dashboard has no content to replay yet.");
    const recording = { id: artifactId, version, title, program };
    this.recordings.set(artifactId, recording);
    return recording;
  }

  /** The run, beat by beat: what the chat and the dashboard's stream say, and when. */
  private script(scenario: Scenario, recording: Recording): Beat[] {
    const beats: Beat[] = [];
    const edit = scenario.kind === "edit";
    const tool = edit ? "edit_dashboard" : "create_dashboard";
    const callId = `call_lab_${Date.now().toString(36)}_${this.run}`;
    const title = recording.title;
    const header = `]]>openui:content?artifact_id=${this.streamId}&type=dashboard&name=${encodeURIComponent(title)}&version=${this.streamVersion}`;
    const say = (sentence: string) => `${sentence}\n${header}\n`;
    const result = (content: string) =>
      this.emitChat({ type: "TOOL_CALL_RESULT", messageId: crypto.randomUUID(), toolCallId: callId, content, role: "tool" });

    // The chat agent looks at the data first, as the real one does, then starts the dashboard.
    beats.push({
      stage: "Thinking: the call has started",
      wait: 0,
      run: () => {
        this.emitChat({ type: "RUN_STARTED", threadId: "lab", runId: `lab-${this.run}` });
        const look = `${callId}_look`;
        this.emitChat({ type: "TOOL_CALL_START", toolCallId: look, toolCallName: "list_connections" });
        this.emitChat({ type: "TOOL_CALL_ARGS", toolCallId: look, delta: "{}" });
        this.emitChat({ type: "TOOL_CALL_END", toolCallId: look });
        this.emitChat({ type: "TOOL_CALL_RESULT", messageId: crypto.randomUUID(), toolCallId: look, content: "[]", role: "tool" });
        this.emitChat({ type: "TOOL_CALL_START", toolCallId: callId, toolCallName: tool });
        this.emitChat({
          type: "TOOL_CALL_ARGS",
          toolCallId: callId,
          delta: JSON.stringify(
            edit
              ? { dashboard: recording.id, prompt: scenario.prompt }
              : { title, description: `A replay for the build lab: ${scenario.label.toLowerCase()}.`, prompt: scenario.prompt },
          ),
        });
        this.emitChat({ type: "TOOL_CALL_END", toolCallId: callId });
      },
    });
    // The dashboard has an id: the route's event reaches the chat, and the stream opens. Still thinking.
    beats.push({
      stage: "Thinking: the dashboard has an id",
      wait: 3200,
      run: () => {
        this.emitArtifact({ event: "reference", data: { id: this.streamId, type: "dashboard", title, version: this.streamVersion } });
        // An edit's stream sends the dashboard as it is, in one piece, before the agent's steps.
        if (edit) this.emitArtifact({ event: "delta", data: { text: recording.program } });
        const started: DashboardStarted = {
          toolCallId: callId,
          tool,
          response: say(edit ? "Editing the dashboard; the user sees the new version when it's ready." : `Started the dashboard "${title}"; the user sees it as it's generated.`),
        };
        this.emitChat({ type: "CUSTOM", name: DASHBOARD_STARTED, value: started });
      },
    });
    scenario.rounds.forEach((round, i) => {
      beats.push({
        stage: `Tool calls: round ${i + 1} of ${scenario.rounds.length}`,
        wait: i === 0 ? 1400 : 2600,
        run: () => this.emitArtifact({ event: "step", data: { tools: round.tools, scripts: round.scripts ?? [] } }),
      });
    });

    if (scenario.kind === "fail") {
      beats.push({
        stage: "Failed",
        wait: 2600,
        run: () => {
          this.emitArtifact({ event: "error", data: { code: "generation-failed", message: FAILURE } });
          this.closeArtifact();
          result(FAILURE);
          this.finishChat("I couldn't finish that dashboard: one of the data sources stopped answering. Try again in a moment.");
        },
      });
      return beats;
    }

    // The program, in pieces, at about the pace Cloud sends it. An edit's patch is a few of the
    // dashboard's own statements again: the parser merges them in, and the dashboard looks the same.
    const text = edit ? "\n" + recording.program.trim().split("\n").slice(-3).join("\n") + "\n" : recording.program;
    const pieces = text.match(/[\s\S]{1,70}/g) ?? [text];
    pieces.forEach((piece, i) => {
      beats.push({
        stage: edit ? "Updating dashboard" : "Building dashboard",
        wait: i === 0 ? 2600 : edit ? 600 : 85,
        flow: i > 0,
        run: () => this.emitArtifact({ event: "delta", data: { text: piece } }),
      });
    });
    beats.push({
      stage: "The stream ends",
      wait: 500,
      run: () => {
        this.emitArtifact({ event: "end", data: {} });
        this.closeArtifact();
      },
    });
    beats.push({
      stage: edit ? "Updated" : "Ready",
      wait: 1800,
      run: () => {
        result(say(edit ? `Edited the dashboard "${title}".` : `Created the dashboard "${title}".`));
        this.finishChat(edit ? `I updated **${title}** with the change you asked for.` : `I built **${title}**. Ask me to change anything in it.`);
      },
    });
    return beats;
  }

  // ── Playback ──

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Runs the next beat, then whatever follows it without waiting on anyone. */
  private step = () => {
    this.clearTimer();
    const beat = this.beats[this.index];
    if (!beat) return;
    this.index += 1;
    beat.run();
    if (this.state.stage !== beat.stage) this.set({ stage: beat.stage });
    if (this.index >= this.beats.length) {
      this.set({ running: false });
      return;
    }
    this.schedule();
  };

  private schedule() {
    if (this.timer) return;
    const next = this.beats[this.index];
    if (!next || !this.state.running) return;
    if (next.flow || this.state.auto) this.timer = setTimeout(this.step, next.wait / this.state.speed);
  }

  /** The chat stream is open: the run begins. */
  private begin() {
    this.schedule();
    if (!this.timer) this.step(); // Stepping from the start: at least show the first stage.
  }

  /** Go on to the next stage now. */
  next() {
    if (this.state.running) this.step();
  }

  /** Ends the run where it is: both streams close. */
  stop() {
    this.clearTimer();
    this.armed = false;
    this.closeArtifact();
    if (this.chat) {
      try {
        this.chat.close();
      } catch {}
      this.chat = null;
    }
    if (this.state.running) this.set({ running: false });
  }

  // ── The chat's reply ──

  /** In place of the chat request: an AG-UI event stream the script writes. */
  chatResponse(signal?: AbortSignal): Response {
    this.armed = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.chat = controller;
        signal?.addEventListener("abort", () => this.stop());
        this.begin();
      },
      cancel: () => this.stop(),
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  private emitChat(event: Record<string, unknown>) {
    try {
      this.chat?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {}
  }

  private finishChat(text: string) {
    const messageId = crypto.randomUUID();
    this.emitChat({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    this.emitChat({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text });
    this.emitChat({ type: "TEXT_MESSAGE_END", messageId });
    this.emitChat({ type: "RUN_FINISHED", threadId: "lab", runId: `lab-${this.run}` });
    try {
      this.chat?.close();
    } catch {}
    this.chat = null;
  }

  // ── The dashboard's stream ──

  private emitArtifact(event: SseEvent) {
    this.artifactLog.push(event);
    this.artifactListeners.forEach((listener) => listener(event));
  }

  private closeArtifact() {
    if (!this.artifactOpen) return;
    this.artifactOpen = false;
    this.artifactListeners.forEach((listener) => listener(null));
    this.artifactListeners.clear();
  }

  /**
   * The app's fetch for OpenUI Cloud, with the lab's dashboard scripted: its stream is the run's
   * events (everything so far, then the rest as it comes), and its other calls go to the real
   * dashboard it replays. Every other request passes through untouched.
   */
  cloudFetch = (base: typeof fetch): typeof fetch => {
    return async (input, init) => {
      const id = this.streamId;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!LAB_ENABLED || !id || !this.recording || !url.includes(`/v1/artifacts/${id}`)) return base(input, init);
      if (new URL(url).pathname.endsWith(`/v1/artifacts/${id}/stream`)) {
        // After an edit run is over, the real dashboard answers for itself again.
        if (!this.artifactOpen && id === this.recording.id) return base(input, init);
        return this.artifactResponse(init?.signal ?? undefined);
      }
      if (id === this.recording.id) return base(input, init);
      // A new dashboard's saved query results: there are none, and the lab keeps none.
      if (url.includes("/query-results")) {
        return new Response(init?.method === "PUT" ? null : JSON.stringify({ data: {} }), {
          status: init?.method === "PUT" ? 204 : 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return base(url.replace(`/v1/artifacts/${id}`, `/v1/artifacts/${this.recording.id}`), init);
    };
  };

  private artifactResponse(signal?: AbortSignal): Response {
    let n = 0;
    const frame = (event: SseEvent) => encoder.encode(`event: ${event.event}\nid: ${++n}\ndata: ${JSON.stringify(event.data)}\n\n`);
    let listener: ((event: SseEvent | null) => void) | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const event of this.artifactLog) controller.enqueue(frame(event));
        if (!this.artifactOpen) {
          controller.close();
          return;
        }
        listener = (event) => {
          try {
            if (event) controller.enqueue(frame(event));
            else controller.close();
          } catch {}
        };
        this.artifactListeners.add(listener);
        signal?.addEventListener("abort", () => {
          if (listener) this.artifactListeners.delete(listener);
          try {
            controller.close();
          } catch {}
        });
      },
      cancel: () => {
        if (listener) this.artifactListeners.delete(listener);
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  // ── The dashboard's data ──

  /** A data call from the lab's dashboard, made as the real dashboard it replays (its id, its version). */
  dataRequest<T extends { id: string; version?: string }>(request: T): T {
    if (!LAB_ENABLED || !this.recording || !this.streamId) return request;
    const ours = request.id === this.streamId || (request.id === this.recording.id && request.version?.startsWith("lab-"));
    return ours ? { ...request, id: this.recording.id, version: this.recording.version } : request;
  }
}

export const lab = new LabController();

/** The app's fetch for OpenUI Cloud with the lab's dashboard scripted. One function, so hooks keyed on it stay put. */
export const labFetch: typeof fetch = lab.cloudFetch((input, init) => globalThis.fetch(input, init));
