import { storeChatCompletionHistory } from "@openuidev/server/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { agentTools, getGateway, MAX_ROUNDS, MODEL, SYSTEM_PROMPT, type TurnContext } from "@/lib/agent";
import { chatBodySchema, type ChatBody } from "@/lib/agent/messages";
import { getThreadService } from "@/lib/apps";
import { HttpError, readJson, route } from "@/lib/http";
import { logError } from "@/lib/log";

type Ctx = { params: Promise<{ appId: string }> };

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * One turn of the Build chat. Runs the agent's tool loop over OpenUI Gateway
 * and streams its Markdown back as Chat Completions SSE, for Agent
 * Interface's `openAIAdapter`. Tool calls run here and aren't streamed; when
 * the turn ends it's saved to the thread in OpenUI Cloud.
 */
export const POST = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  const parsed = chatBodySchema.safeParse(await readJson(request, { maxBytes: MAX_BODY_BYTES }));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid chat request");
  const { threadId, messages } = parsed.data as ChatBody;

  const threads = getThreadService();
  if (!(await threads.belongsTo(user.id, appId, threadId))) throw new HttpError(404, "Thread not found");

  const turn: TurnContext = { userId: user.id, appId, signal: request.signal, dashboards: [] };
  const runner = getGateway().chat.completions.runTools(
    {
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools: agentTools(),
      toolContext: turn,
      stream: true,
    },
    { signal: request.signal, maxChatCompletions: MAX_ROUNDS },
  );

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, chunk: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  const text = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });

  const body = new ReadableStream({
    async start(controller) {
      let round: string | undefined;
      let wrote = false;
      try {
        for await (const chunk of runner) {
          const content = chunk.choices[0]?.delta?.content;
          if (!content) continue;
          // Each model round is its own completion; keep their text apart.
          if (chunk.id !== round) {
            if (wrote) send(controller, text("\n\n"));
            round = chunk.id;
          }
          send(controller, text(content));
          wrote = true;
        }
        send(controller, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (!request.signal.aborted) logError("chat.turn", error);
        controller.error(error);
        return; // Cancelled or failed: save nothing.
      }

      // The new turn: the user's message, then every message the loop added.
      const turnMessages = runner.messages.slice(messages.length) as ChatCompletionMessageParam[];
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
