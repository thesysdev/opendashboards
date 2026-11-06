import { EventType, type BaseEvent } from "@ag-ui/core";
import { storeChatCompletionHistory } from "@openuidev/server/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { agentTools, getGateway, MAX_ROUNDS, MODEL, SYSTEM_PROMPT, type TurnContext } from "@/lib/agent";
import { createAgUiTranslator, sse } from "@/lib/agent/ag-ui";
import { chatBodySchema, VIEWING_DASHBOARD, type ChatBody } from "@/lib/agent/messages";
import { getThreadService } from "@/lib/apps";
import { getDashboardService } from "@/lib/dashboards";
import { HttpError, readJson, route } from "@/lib/http";
import { logError } from "@/lib/log";

type Ctx = { params: Promise<{ appId: string }> };

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * One turn of the Build chat. Runs the agent's tool loop over OpenUI Gateway
 * and streams it as AG-UI events (text, tool calls and their results) for
 * the chat's `agUIAdapter`. When the turn ends it's saved to the thread in
 * OpenUI Cloud.
 */
export const POST = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  const parsed = chatBodySchema.safeParse(await readJson(request, { maxBytes: MAX_BODY_BYTES }));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid chat request");
  const { threadId, messages, context } = parsed.data as ChatBody;
  const runId = typeof parsed.data.runId === "string" ? parsed.data.runId : crypto.randomUUID();

  const threads = getThreadService();
  if (!(await threads.belongsTo(user.id, appId, threadId))) throw new HttpError(404, "Thread not found");

  // What's on screen, if it's one of this app's dashboards: "this dashboard" means that one.
  const viewingId = context?.find((entry) => entry.description === VIEWING_DASHBOARD)?.value;
  const viewing = viewingId
    ? (await getDashboardService().list(user.id, appId)).find((row) => row.artifactId === viewingId)
    : undefined;
  const system: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (viewing) {
    system.push({
      role: "system",
      content: `The user is looking at the dashboard "${viewing.title}" (id ${viewing.artifactId}). "This dashboard" means that one.`,
    });
  }

  const encoder = new TextEncoder();
  const turn: TurnContext = { userId: user.id, appId, signal: request.signal, dashboards: [] };

  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: BaseEvent) => controller.enqueue(encoder.encode(sse(event)));
      const translate = createAgUiTranslator(emit);
      emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

      const runner = getGateway().chat.completions.runTools(
        {
          model: MODEL,
          messages: [...system, ...messages],
          tools: agentTools(),
          toolContext: turn,
          stream: true,
        },
        { signal: request.signal, maxChatCompletions: MAX_ROUNDS },
      );
      runner.on("chunk", (chunk) => translate.chunk(chunk));
      runner.on("message", (message) => translate.message(message));

      try {
        await runner.done();
        translate.finish();
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        controller.close();
      } catch (error) {
        if (request.signal.aborted) {
          controller.close();
          return; // Cancelled: save nothing.
        }
        logError("chat.turn", error);
        translate.finish();
        emit({ type: EventType.RUN_ERROR, message: "The agent stopped unexpectedly. Try again." } as BaseEvent);
        controller.close();
        return; // Failed: save nothing.
      }

      // The new turn: the user's message, then every message the loop added.
      const turnMessages = runner.messages.slice(system.length - 1 + messages.length) as ChatCompletionMessageParam[];
      try {
        await storeChatCompletionHistory({
          apiKey: process.env.THESYS_API_KEY ?? "",
          conversationId: threadId,
          messages: turnMessages,
        });
        await threads.touch(user.id, appId, threadId);
      } catch (error) {
        logError("chat.save", error);
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
});
