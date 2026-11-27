import "server-only";

import { OpenUIApiError } from "@openuidev/server";

import { getOpenUI } from "@/lib/dashboards";

/**
 * Whether an OpenUI Cloud conversation is this user's: its owner, read with the
 * API key. A thread id from the browser is never taken on trust.
 */
export async function ownsConversation(userId: string, conversationId: string): Promise<boolean> {
  try {
    return (await getOpenUI().conversations.get(conversationId)).userId === userId;
  } catch (error) {
    if (error instanceof OpenUIApiError && error.status === 404) return false;
    throw error;
  }
}
