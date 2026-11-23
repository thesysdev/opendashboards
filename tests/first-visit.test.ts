import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppService } from "@/lib/apps/service";
import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, dataConnections, orgInvites, orgMembers, users } from "@/lib/db/schema";
import { createOrgService } from "@/lib/orgs/service";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { posthogSource } from "@/lib/sources/posthog/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { seedTeam, seedWorkspaces } from "./orgs";

/*
 * Someone's very first request is often a link straight to an app: a guest
 * sent the link, or a teammate who was just invited. Who they are has to be
 * recorded before their access is checked, or nothing matches them yet.
 */

const { db, pool } = createDatabase(TEST_DATABASE_URL);

const signedIn = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth/user", () => ({
  requireUser: async () => signedIn.user,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/db", async (actual) => ({ ...(await actual<typeof import("@/lib/db")>()), getDb: () => db }));

const { getAppGrant } = await import("@/lib/orgs");

const appsService = createAppService({ db });
const orgs = createOrgService({ db });
const connections = createConnectionService({
  db,
  secrets: () => plaintextSecretBox,
  sources: () => ({ ...posthogSource, test: async () => [] }) as unknown as ConnectionSource,
});

const NEWCOMERS = ["first-guest", "first-teammate"];
let acme: string;

async function app(teamAccess: "private" | "view" = "private") {
  const created = await connections.create(
    { userId: "ed", orgId: acme },
    { type: "posthog", name: `Source ${randomUUID().slice(0, 8)}`, hostKind: "posthog_us", projectId: "1", apiKey: "phx_abcdefghijklmnopqrstuvwxyz1234" },
  );
  if (!created.ok) throw new Error(created.error.code);
  const result = await appsService.create({ userId: "ed", orgId: acme }, { prompt: "Signups", connectionIds: [created.data.id] });
  if (!result.ok) throw new Error(result.error.code);
  await db.update(apps).set({ teamAccess }).where(eq(apps.id, result.data.id));
  return result.data.id;
}

async function forgetNewcomers() {
  await db.delete(orgMembers).where(inArray(orgMembers.userId, NEWCOMERS));
  await db.delete(orgInvites).where(inArray(orgInvites.email, NEWCOMERS.map((id) => `${id}@example.com`)));
  await db.delete(users).where(inArray(users.id, NEWCOMERS));
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections} CASCADE`);
  await seedWorkspaces(db, ["ed"]);
  // Its own workspace, so nobody added here shows up in other files' tests.
  acme = await seedTeam(db, "First visit", { ed: "admin" });
  // Never seen before: no record, no workspace.
  await forgetNewcomers();
});

afterAll(async () => {
  await forgetNewcomers();
  await pool.end();
});

describe("a first visit by link", () => {
  it("opens an app for a guest on their very first request", async () => {
    const appId = await app();
    expect(await appsService.addGuest("ed", { id: appId, email: "first-guest@example.com" })).toEqual({ ok: true, data: undefined });

    signedIn.user = { id: "first-guest", email: "first-guest@example.com" };
    expect(await getAppGrant(appId)).toMatchObject({ access: "view", guest: true });
  });

  it("opens a workspace app for someone invited before they ever signed in", async () => {
    const appId = await app("view");
    expect(await orgs.invite("ed", { orgId: acme, email: "first-teammate@example.com", role: "editor" })).toMatchObject({
      ok: true,
      data: { status: "invited" },
    });

    signedIn.user = { id: "first-teammate", email: "first-teammate@example.com" };
    expect(await getAppGrant(appId)).toMatchObject({ access: "view", guest: false, role: "editor" });
  });
});
