import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { chatUsage } from "@/lib/db/schema";

/** Stored as `user_id` for the total across all users. No real user id contains it. */
const ALL_USERS = "*";

/** Longer than a chat can run, so a crashed turn can't lock its user out for good. */
const ACTIVE_TURN_MS = 15 * 60 * 1000;

export type ChatLimitSettings = { perUserPerDay: number; perDay: number };
export type ChatLimitRefusal = "user_limit" | "busy" | "global_limit";
export type ChatReservation = { ok: true; day: string } | { ok: false; reason: ChatLimitRefusal };

export const CHAT_LIMIT_MESSAGES: Record<ChatLimitRefusal, string> = {
  user_limit: "You've reached today's chat limit. It resets at midnight UTC.",
  busy: "Another chat of yours is still running. Wait for it to finish and try again.",
  global_limit: "Prism has reached its chat limit for today. It resets at midnight UTC.",
};

class Refused extends Error {
  constructor(readonly reason: ChatLimitRefusal) {
    super(reason);
  }
}

/**
 * Daily chat limits, per user and overall. A turn takes a slot before its first
 * model call, and each increment is one conditional statement, so parallel
 * requests can't slip past. A chat always answers 200 and fails inside its
 * stream, so the route says how a turn ended rather than this reading a status.
 */
export function createChatLimits({ db, limits, now = () => new Date() }: { db: Database; limits: ChatLimitSettings; now?: () => Date }) {
  return {
    async reserve(userId: string): Promise<ChatReservation> {
      const time = now();
      const day = time.toISOString().slice(0, 10);
      const activeUntil = new Date(time.getTime() + ACTIVE_TURN_MS);
      if (limits.perUserPerDay <= 0) return { ok: false, reason: "user_limit" };
      if (limits.perDay <= 0) return { ok: false, reason: "global_limit" };

      try {
        await db.transaction(async (tx) => {
          const taken = await tx
            .insert(chatUsage)
            .values({ day, userId, turns: 1, activeUntil })
            .onConflictDoUpdate({
              target: [chatUsage.day, chatUsage.userId],
              set: { turns: sql`${chatUsage.turns} + 1`, activeUntil },
              setWhere: sql`${chatUsage.turns} < ${limits.perUserPerDay} AND (${chatUsage.activeUntil} IS NULL OR ${chatUsage.activeUntil} < ${time.toISOString()}::timestamptz)`,
            })
            .returning({ turns: chatUsage.turns });
          if (!taken.length) {
            const [row] = await tx
              .select({ turns: chatUsage.turns })
              .from(chatUsage)
              .where(and(eq(chatUsage.day, day), eq(chatUsage.userId, userId)));
            throw new Refused(row && row.turns >= limits.perUserPerDay ? "user_limit" : "busy");
          }

          const total = await tx
            .insert(chatUsage)
            .values({ day, userId: ALL_USERS, turns: 1 })
            .onConflictDoUpdate({
              target: [chatUsage.day, chatUsage.userId],
              set: { turns: sql`${chatUsage.turns} + 1` },
              setWhere: sql`${chatUsage.turns} < ${limits.perDay}`,
            })
            .returning({ turns: chatUsage.turns });
          if (!total.length) throw new Refused("global_limit");
        });
      } catch (error) {
        if (error instanceof Refused) return { ok: false, reason: error.reason };
        throw error;
      }
      return { ok: true, day };
    },

    /** Ends a turn. `refund` gives its slot back when the user got nothing for it. */
    async finish(userId: string, day: string, { refund }: { refund: boolean }): Promise<void> {
      const giveBack = refund ? sql`GREATEST(${chatUsage.turns} - 1, 0)` : sql`${chatUsage.turns}`;
      await db.transaction(async (tx) => {
        await tx
          .update(chatUsage)
          .set({ activeUntil: null, turns: giveBack })
          .where(and(eq(chatUsage.day, day), eq(chatUsage.userId, userId)));
        if (refund) {
          await tx
            .update(chatUsage)
            .set({ turns: giveBack })
            .where(and(eq(chatUsage.day, day), eq(chatUsage.userId, ALL_USERS)));
        }
      });
    },
  };
}

export type ChatLimits = ReturnType<typeof createChatLimits>;
