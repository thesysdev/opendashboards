import type { ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { threadIdSchema } from "@/lib/apps/schemas";

/**
 * What the Build chat sends: the thread and the user's new message, in Agent
 * Interface's request shape. Text only. The thread's earlier turns aren't taken
 * from the browser: the route reads them from the thread's conversation in
 * OpenUI Cloud.
 */

const MAX_TEXT = 200_000;

const text = z.string().max(MAX_TEXT);
const textParts = z
  .array(z.object({ type: z.literal("text"), text }).strip())
  .max(20);

const userMessage = z
  .object({
    role: z.literal("user", { error: "The last message must be the user's." }),
    content: z.union([text.min(1), textParts.min(1)]),
  })
  .strip();

/** The AG-UI `context` entry naming the dashboard the user is looking at; its value is the dashboard's id. */
export const VIEWING_DASHBOARD = "The dashboard the user is looking at";

const contextEntry = z.object({ description: z.string().max(200), value: z.string().max(500) }).strip();

export const chatBodySchema = z
  .object({
    threadId: threadIdSchema,
    runId: z.string().max(200).optional().catch(undefined),
    context: z.array(contextEntry).max(10).optional(),
    // Agent Interface's `messages`; only the last one, the user's new message, is used, so a tab
    // that still sends the whole thread keeps working.
    messages: z
      .array(z.unknown())
      .min(1)
      .max(200)
      .transform((messages) => messages.at(-1))
      .pipe(userMessage),
  })
  .transform(({ messages, ...body }) => ({ ...body, message: messages as ChatCompletionUserMessageParam }));
