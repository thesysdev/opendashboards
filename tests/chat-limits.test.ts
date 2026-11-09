import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createChatLimits } from "@/lib/apps/chat-limits";
import { createDatabase } from "@/lib/db";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);
const noon = new Date("2026-11-09T12:00:00Z");
const limitsWith = (perUserPerDay: number, perDay: number, now = () => noon) => createChatLimits({ db, limits: { perUserPerDay, perDay }, now });

async function turns(userId: string, day = "2026-11-09") {
  const { rows } = await db.execute(sql`select turns from chat_usage where day = ${day} and user_id = ${userId}`);
  return (rows[0] as { turns: number } | undefined)?.turns ?? 0;
}

async function run(limits: ReturnType<typeof limitsWith>, userId: string, refund = false) {
  const reservation = await limits.reserve(userId);
  if (reservation.ok) await limits.finish(userId, reservation.day, { refund });
  return reservation;
}

beforeEach(() => db.execute(sql`truncate chat_usage`));
afterAll(() => pool.end());

describe("chat limits", () => {
  it("counts turns per user and overall", async () => {
    const limits = limitsWith(5, 50);
    await run(limits, "alice");
    await run(limits, "alice");
    await run(limits, "bob");
    expect([await turns("alice"), await turns("bob"), await turns("*")]).toEqual([2, 1, 3]);
  });

  it("refuses a user at their limit, without affecting others", async () => {
    const limits = limitsWith(2, 50);
    await run(limits, "alice");
    await run(limits, "alice");
    await expect(limits.reserve("alice")).resolves.toEqual({ ok: false, reason: "user_limit" });
    await expect(limits.reserve("bob")).resolves.toMatchObject({ ok: true });
    expect(await turns("*")).toBe(3);
  });

  it("refuses everyone at the overall limit, and doesn't charge the refused user", async () => {
    const limits = limitsWith(5, 1);
    await run(limits, "alice");
    await expect(limits.reserve("bob")).resolves.toEqual({ ok: false, reason: "global_limit" });
    expect(await turns("bob")).toBe(0);
  });

  it("treats an overall limit of 0 as chat being off", async () => {
    await expect(limitsWith(5, 0).reserve("alice")).resolves.toEqual({ ok: false, reason: "global_limit" });
  });

  it("runs one turn per user at a time", async () => {
    const limits = limitsWith(5, 50);
    const first = await limits.reserve("alice");
    await expect(limits.reserve("alice")).resolves.toEqual({ ok: false, reason: "busy" });
    if (first.ok) await limits.finish("alice", first.day, { refund: false });
    await expect(limits.reserve("alice")).resolves.toMatchObject({ ok: true });
  });

  it("frees a turn that crashed once it expires", async () => {
    await limitsWith(5, 50).reserve("alice");
    const later = () => new Date(noon.getTime() + 16 * 60 * 1000);
    await expect(limitsWith(5, 50, later).reserve("alice")).resolves.toMatchObject({ ok: true });
  });

  it("gives a failed turn's slot back to the user and the total", async () => {
    const limits = limitsWith(1, 50);
    await run(limits, "alice", true);
    expect([await turns("alice"), await turns("*")]).toEqual([0, 0]);
    await expect(limits.reserve("alice")).resolves.toMatchObject({ ok: true });
  });

  it("lets exactly the limit through when requests race", async () => {
    const limits = limitsWith(100, 3);
    const results = await Promise.all(["a", "b", "c", "d", "e", "f", "g", "h"].map((user) => limits.reserve(user)));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(await turns("*")).toBe(3);
  });

  it("starts a new count each UTC day", async () => {
    const limits = limitsWith(1, 50);
    await run(limits, "alice");
    const tomorrow = () => new Date("2026-11-10T00:00:01Z");
    await expect(limitsWith(1, 50, tomorrow).reserve("alice")).resolves.toEqual({ ok: true, day: "2026-11-10" });
  });
});
