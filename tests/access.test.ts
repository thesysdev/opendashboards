import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAppService } from "@/lib/apps/service";
import { createThreadService } from "@/lib/apps/threads";
import { createConnectionService } from "@/lib/connections/service";
import { createOrgService } from "@/lib/orgs/service";
import { createDashboardService } from "@/lib/dashboards/service";
import { createDatabase } from "@/lib/db";
import { appMembers, apps, dataConnections, mcpOAuthSignIns, orgMembers, type AppTeamAccess, type OrgRole } from "@/lib/db/schema";
import { appGroups, cloudIdentity } from "@/lib/dashboards/cloud";
import { accessFor, appAccess, canChange } from "@/lib/orgs/access";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { posthogSource } from "@/lib/sources/posthog/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { workspaceOf, seedWorkspaces, seedTeam } from "./orgs";

const { db, pool } = createDatabase(TEST_DATABASE_URL);
const appsService = createAppService({ db });
const threads = createThreadService({ db });
const orgsService = createOrgService({ db });
const dashboards = createDashboardService({ db });
const connections = createConnectionService({
  db,
  secrets: () => plaintextSecretBox,
  sources: () => ({ ...posthogSource, test: async () => [] }) as unknown as ConnectionSource,
});

const KEYED = { type: "posthog", name: "Production", hostKind: "posthog_us", projectId: "1", apiKey: "phx_abcdefghijklmnopqrstuvwxyz1234" };

/** Acme: Alice is its admin, Ed an editor, Vera a viewer. Mallory is in no team with them. */
let acme: string;
const inAcme = (userId: string) => ({ userId, orgId: acme });

async function keyed(userId: string, name = "Production") {
  const result = await connections.create(inAcme(userId), { ...KEYED, name });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.id;
}

/** A sign-in (OAuth) connection of `userId`'s in Acme, personal unless said otherwise. */
async function signedIn(userId: string, sharing: "personal" | "org" = "personal") {
  const [row] = await db
    .insert(dataConnections)
    .values({
      id: randomUUID(),
      userId,
      orgId: acme,
      sharing,
      name: "Linear",
      type: "mcp",
      config: {
        type: "mcp",
        url: "https://mcp.linear.app/mcp",
        headerName: "Authorization",
        oauth: { issuer: "https://mcp.linear.app", tokenEndpoint: "https://mcp.linear.app/token", resource: "https://mcp.linear.app/mcp" },
      },
      secret: { v: 1, provider: "plaintext", value: "{}" },
      credentialHint: "signed in",
      status: "ok",
      lastCheckedAt: new Date(),
    })
    .returning({ id: dataConnections.id });
  return row.id;
}

async function app(userId: string, teamAccess: AppTeamAccess = "private") {
  const connectionId = await keyed("alice", `Source ${randomUUID().slice(0, 8)}`);
  const result = await appsService.create(inAcme(userId), { prompt: "Signups", connectionIds: [connectionId] });
  if (!result.ok) throw new Error(result.error.code);
  await db.update(apps).set({ teamAccess }).where(eq(apps.id, result.data.id));
  return { appId: result.data.id, connectionId };
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${mcpOAuthSignIns} CASCADE`);
  await seedWorkspaces(db, ["alice", "ed", "vera", "mallory"]);
  acme = await seedTeam(db, "Acme", { alice: "admin", ed: "editor", vera: "viewer" });
});

afterAll(() => pool.end());

describe("access to an app", () => {
  const roles: OrgRole[] = ["admin", "editor", "viewer"];

  it("is the lower of the member's role and what the app grants the team", () => {
    const of = (teamAccess: AppTeamAccess) => roles.map((role) => accessFor({ userId: "owner", teamAccess }, "someone", role));
    expect(of("private")).toEqual([null, null, null]);
    expect(of("view")).toEqual(["view", "view", "view"]);
    expect(of("edit")).toEqual(["edit", "edit", "view"]);
  });

  it("is full for the owner, though a viewer still can't build", () => {
    expect(roles.map((role) => accessFor({ userId: "owner", teamAccess: "private" }, "owner", role))).toEqual(["owner", "owner", "owner"]);
    expect(roles.map((role) => canChange("owner", role))).toEqual([true, true, false]);
    expect(canChange("view", "admin")).toBe(false);
  });

  it("keeps a private app from everyone else, the team's admin included", async () => {
    const { appId } = await app("ed");
    expect(await appAccess(db, "ed", appId)).toMatchObject({ access: "owner", canChange: true });
    for (const other of ["alice", "vera", "mallory"]) {
      expect(await appAccess(db, other, appId)).toBeNull();
      expect(await appsService.get(other, appId)).toBeNull();
      expect(await dashboards.list(other, appId)).toEqual([]);
    }
    expect((await appsService.list(inAcme("alice"))).map((row) => row.id)).not.toContain(appId);
  });

  it("lets the team open an app shared for viewing, and change nothing", async () => {
    const { appId } = await app("ed", "view");
    await dashboards.record("ed", appId, { artifactId: "art_1", title: "Signups" });

    for (const member of ["alice", "vera"]) {
      expect(await appsService.get(member, appId)).toMatchObject({ access: "view", canChange: false });
      expect((await dashboards.list(member, appId)).map((row) => row.title)).toEqual(["Signups"]);
      expect(await dashboards.findByArtifact(member, "art_1")).toMatchObject({ appId });
      expect(await appsService.rename(member, { id: appId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await dashboards.record(member, appId, { artifactId: "art_2", title: "Extra" })).toBeNull();
      expect(await dashboards.update(member, appId, "00000000-0000-4000-8000-000000000000", { title: "x" })).toBe(false);
      expect(await threads.register(member, appId, { threadId: "thread_1", title: "Hi" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect((await appsService.list(inAcme("vera"))).map((row) => ({ id: row.id, mine: row.mine }))).toEqual([{ id: appId, mine: false }]);
    expect(await appAccess(db, "mallory", appId)).toBeNull();
  });

  it("lets editors and admins change an app shared for editing, but a viewer only view it", async () => {
    const { appId } = await app("ed", "edit");
    expect(await appsService.get("alice", appId)).toMatchObject({ access: "edit", canChange: true });
    expect(await appsService.rename("alice", { id: appId, name: "Renamed" })).toEqual({ ok: true, data: undefined });
    expect(await dashboards.record("alice", appId, { artifactId: "art_1", title: "By Alice" })).not.toBeNull();
    expect(await threads.register("alice", appId, { threadId: "thread_a", title: "Hi" })).toMatchObject({ ok: true });

    expect(await appsService.get("vera", appId)).toMatchObject({ access: "view", canChange: false });
    expect(await threads.register("vera", appId, { threadId: "thread_v", title: "Hi" })).toMatchObject({ ok: false });
  });

  it("only lets the owner delete an app", async () => {
    const { appId } = await app("ed", "edit");
    expect(await appsService.remove("alice", { id: appId })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.remove("ed", { id: appId })).toEqual({ ok: true, data: undefined });
  });

  it("keeps each member's chats their own, even in a shared app", async () => {
    const { appId } = await app("ed", "edit");
    await threads.register("ed", appId, { threadId: "thread_ed", title: "Ed's" });
    await threads.register("alice", appId, { threadId: "thread_alice", title: "Alice's" });
    const list = await threads.list("alice", appId);
    expect(list.ok && list.data.threads.map((thread) => thread.id)).toEqual(["thread_alice"]);
    expect(await threads.belongsTo("alice", appId, "thread_ed")).toBe(false);
  });

  it("ends when the member leaves the team", async () => {
    const { appId } = await app("ed", "edit");
    await seedTeam(db, "Acme", { alice: "admin", vera: "viewer" });
    await db.execute(sql`DELETE FROM org_members WHERE org_id = ${acme} AND user_id = 'ed'`);
    expect(await appAccess(db, "ed", appId)).toBeNull();
  });
});

describe("a viewer", () => {
  it("can't create an app or a connection, or install a demo", async () => {
    const connectionId = await keyed("alice");
    expect(await appsService.create(inAcme("vera"), { prompt: "Signups", connectionIds: [connectionId] })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await connections.create(inAcme("vera"), KEYED)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await connections.installDemo(inAcme("vera"), { dataset: "retail" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("can use the team's connections but not change them", async () => {
    const connectionId = await keyed("alice");
    expect((await connections.list(inAcme("vera"))).map(({ id, canManage }) => ({ id, canManage }))).toEqual([{ id: connectionId, canManage: false }]);
    expect(await connections.rename("vera", { id: connectionId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await connections.remove("vera", { id: connectionId })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await connections.replaceCredential("vera", { id: connectionId, credential: KEYED.apiKey })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});

describe("connections in a team", () => {
  it("serve every member when they have a key, and any editor can manage them", async () => {
    const connectionId = await keyed("alice");
    for (const member of ["alice", "ed", "vera"]) {
      expect(await connections.open(member, connectionId, "posthog")).toMatchObject({ id: connectionId, credential: KEYED.apiKey });
    }
    expect((await connections.list(inAcme("ed")))[0]).toMatchObject({ sharing: "org", mine: false, addedBy: "alice@example.com", canManage: true });
    expect(await connections.rename("ed", { id: connectionId, name: "Prod" })).toEqual({ ok: true, data: undefined });
    // Re-keyed by someone else: still sealed for whoever added it, and still opens for everyone.
    expect(await connections.replaceCredential("ed", { id: connectionId, credential: "phx_zyxwvutsrqponmlkjihgfedcba4321" })).toMatchObject({ ok: true });
    expect(await connections.open("vera", connectionId, "posthog")).toMatchObject({ credential: "phx_zyxwvutsrqponmlkjihgfedcba4321" });
    expect(await connections.remove("ed", { id: connectionId })).toEqual({ ok: true, data: undefined });
  });

  it("are out of reach of anyone outside the team", async () => {
    const connectionId = await keyed("alice");
    expect(await connections.open("mallory", connectionId, "posthog")).toBeNull();
    expect(await connections.rename("mallory", { id: connectionId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await connections.list(workspaceOf("mallory"))).toEqual([]);
    // Naming the team doesn't help: membership is read from the database.
    expect(await connections.list(inAcme("mallory"))).toEqual([]);
    expect(await connections.create(inAcme("mallory"), KEYED)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("never open from another org's app, even for someone in both", async () => {
    const connectionId = await keyed("alice");
    expect(await connections.open("alice", connectionId, "posthog", { orgId: workspaceOf("alice").orgId })).toBeNull();
    expect(await connections.open("alice", connectionId, "posthog", { orgId: acme })).not.toBeNull();
  });

  it("keep a sign-in to whoever signed in, the team's admin included", async () => {
    const connectionId = await signedIn("ed");
    expect(await connections.open("ed", connectionId, "mcp")).not.toBeNull();
    for (const other of ["alice", "vera", "mallory"]) {
      expect(await connections.open(other, connectionId, "mcp")).toBeNull();
      expect(await connections.remove(other, { id: connectionId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect((await connections.list(inAcme("alice"))).map((row) => row.id)).not.toContain(connectionId);
    expect((await connections.list(inAcme("ed"))).find((row) => row.id === connectionId)).toMatchObject({ sharing: "personal", mine: true });
  });

  it("let only whoever signed in share a sign-in, after which everyone queries with it", async () => {
    const connectionId = await signedIn("ed");
    expect(await connections.setSharing("alice", { id: connectionId, sharing: "org" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await connections.setSharing("ed", { id: connectionId, sharing: "org" })).toEqual({ ok: true, data: undefined });

    expect(await connections.open("vera", connectionId, "mcp")).not.toBeNull();
    expect((await connections.list(inAcme("alice"))).find((row) => row.id === connectionId)).toMatchObject({
      sharing: "org",
      mine: false,
      addedBy: "ed@example.com",
    });
    // Shared, but still Ed's: nobody else takes it back or signs in to it again.
    expect(await connections.setSharing("alice", { id: connectionId, sharing: "personal" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await connections.startSignIn(inAcme("alice"), {
        stateHash: "a".repeat(64),
        connectionId,
        name: "Linear",
        config: { type: "mcp", url: "https://mcp.linear.app/mcp", headerName: "Authorization" },
        pending: "{}",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });

    expect(await connections.setSharing("ed", { id: connectionId, sharing: "personal" })).toEqual({ ok: true, data: undefined });
    expect(await connections.open("vera", connectionId, "mcp")).toBeNull();
  });

  it("can always be taken back by whoever signed in, even once they're only a viewer", async () => {
    const connectionId = await signedIn("ed", "org");
    await seedTeam(db, "Acme", { ed: "viewer" });
    // A viewer can't share anything, but can stop everyone querying as them.
    expect(await connections.setSharing("ed", { id: connectionId, sharing: "org" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await connections.setSharing("ed", { id: connectionId, sharing: "personal" })).toEqual({ ok: true, data: undefined });
    expect(await connections.open("vera", connectionId, "mcp")).toBeNull();
  });

  it("are deleted when whoever signed in leaves or is removed, and keys keep serving the workspace", async () => {
    const eds = await signedIn("ed", "org");
    const key = await keyed("ed");
    const veras = await signedIn("vera", "org");
    // A teammate's app that used Ed's sign-in.
    const { appId } = await app("alice", "edit");
    expect(await appsService.addConnection("alice", { appId, connectionId: eds })).toEqual({ ok: true, data: undefined });

    // Removed: their sign-in is deleted outright, and taken off the app that used it. Their key stays.
    expect(await orgsService.removeMember("alice", { orgId: acme, userId: "ed" })).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(dataConnections).where(eq(dataConnections.id, eds))).toEqual([]);
    expect((await appsService.get("alice", appId))?.connections.map((row) => row.id)).not.toContain(eds);
    expect(await connections.open("alice", key, "posthog")).not.toBeNull();

    // Leaving ends the same way: their sign-in is deleted too.
    expect(await orgsService.leave("vera", { orgId: acme })).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(dataConnections).where(eq(dataConnections.id, veras))).toEqual([]);
  });

  it("never make a key personal", async () => {
    const connectionId = await keyed("ed");
    expect(await connections.setSharing("ed", { id: connectionId, sharing: "personal" })).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("can't be deleted while another member's private app uses them, without naming that app", async () => {
    const { connectionId } = await app("ed");
    const result = await connections.remove("alice", { id: connectionId });
    expect(result).toMatchObject({ ok: false, error: { code: "in_use", apps: [] } });
    expect(result.ok ? "" : result.error.message).toContain("another member's app");
  });

  it("only join an app of the same org, by someone who can change it", async () => {
    const { appId } = await app("ed", "view");
    const extra = await keyed("alice", "Extra");
    expect(await appsService.addConnection("vera", { appId, connectionId: extra })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await appsService.addConnection("ed", { appId, connectionId: extra })).toEqual({ ok: true, data: undefined });

    await seedWorkspaces(db, ["ed"]);
    const own = await connections.create(workspaceOf("ed"), KEYED);
    expect(own.ok && (await appsService.addConnection("ed", { appId, connectionId: own.data.id }))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("sharing an app", () => {
  it("is for whoever can change it, like a shared document", async () => {
    const { appId } = await app("ed");
    expect(await appsService.setTeamAccess("alice", { id: appId, teamAccess: "edit" })).toMatchObject({ ok: false, error: { code: "not_found" } });

    expect(await appsService.setTeamAccess("ed", { id: appId, teamAccess: "view" })).toEqual({ ok: true, data: undefined });
    expect(await appsService.get("alice", appId)).toMatchObject({ access: "view", teamAccess: "view" });
    // Viewing isn't enough to re-share.
    for (const member of ["alice", "vera"]) {
      expect(await appsService.setTeamAccess(member, { id: appId, teamAccess: "edit" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }

    await appsService.setTeamAccess("ed", { id: appId, teamAccess: "edit" });
    // An editor of a shared app can re-share it, a viewer still can't.
    expect(await appsService.setTeamAccess("vera", { id: appId, teamAccess: "private" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.setTeamAccess("alice", { id: appId, teamAccess: "private" })).toEqual({ ok: true, data: undefined });
    expect(await appsService.get("alice", appId)).toBeNull();
    expect(await appsService.get("ed", appId)).toMatchObject({ access: "owner", teamAccess: "private" });
  });

  it("shows shared apps to the workspace, saying whose they are and what can be changed", async () => {
    const { appId } = await app("ed", "edit");
    expect((await appsService.list(inAcme("alice"))).map(({ id, mine, sharedBy }) => ({ id, mine, sharedBy }))).toEqual([
      { id: appId, mine: false, sharedBy: "ed@example.com" },
    ]);
    expect((await appsService.list(inAcme("ed")))[0]).toMatchObject({ mine: true, sharedBy: null });
    expect((await appsService.tree(inAcme("alice"))).map(({ id, mine, canChange }) => ({ id, mine, canChange }))).toEqual([
      { id: appId, mine: false, canChange: true },
    ]);
    expect((await appsService.tree(inAcme("ed"))).map(({ id, mine }) => ({ id, mine }))).toEqual([{ id: appId, mine: true }]);
    expect((await appsService.tree(inAcme("vera"))).map(({ id, canChange }) => ({ id, canChange }))).toEqual([{ id: appId, canChange: false }]);
  });

  it("tells OpenUI Cloud only the one group of the app that the person's access earns", async () => {
    const { appId } = await app("ed", "edit");
    const groups = appGroups(appId);
    expect(groups).toEqual({ view: `app:${appId}:view`, edit: `app:${appId}:edit` });
    expect(groups.edit.length).toBeLessThanOrEqual(64);
    const identity = async (userId: string) => cloudIdentity(userId, (await appAccess(db, userId, appId))!);
    expect(await identity("ed")).toEqual({ userId: "ed", groupIds: [groups.edit] });
    expect(await identity("alice")).toEqual({ userId: "alice", groupIds: [groups.edit] });
    expect(await identity("vera")).toEqual({ userId: "vera", groupIds: [groups.view] });
    expect(await appAccess(db, "mallory", appId)).toBeNull();
  });
});

describe("a teammate's personal sign-in in a shared app", () => {
  /** Ed's app, shared for editing, using Ed's personal Linear sign-in. */
  async function sharedWithSignIn() {
    const { appId } = await app("ed", "edit");
    const eds = await signedIn("ed");
    expect(await appsService.addConnection("ed", { appId, connectionId: eds })).toEqual({ ok: true, data: undefined });
    return { appId, eds };
  }

  it("never runs a teammate's queries as its owner: they're asked to sign in", async () => {
    const { appId, eds } = await sharedWithSignIn();
    expect(await connections.open("alice", eds, "mcp", { orgId: acme })).toBeNull();
    expect(await connections.signInNeeded("alice", eds)).toMatchObject({ orgId: acme, name: "Linear" });
    expect((await appsService.get("alice", appId))?.connections.find((row) => row.id === eds)).toMatchObject({
      sharing: "personal",
      mine: false,
      needsSignIn: true,
    });
    // Its owner needs nothing, and someone outside the workspace learns nothing.
    expect(await connections.signInNeeded("ed", eds)).toBeNull();
    expect((await appsService.get("ed", appId))?.connections.find((row) => row.id === eds)).toMatchObject({ mine: true, needsSignIn: false });
    expect(await connections.signInNeeded("mallory", eds)).toBeNull();
  });

  it("opens as the teammate's own sign-in to the same server, once they have one", async () => {
    const { appId, eds } = await sharedWithSignIn();
    const alices = await signedIn("alice");

    const opened = await connections.open("alice", eds, "mcp", { orgId: acme });
    expect(opened?.id).toBe(alices);
    expect(await connections.signInNeeded("alice", eds)).toBeNull();
    expect((await appsService.get("alice", appId))?.connections.find((row) => row.id === eds)).toMatchObject({ needsSignIn: false });
    // Still not Vera's.
    expect(await connections.open("vera", eds, "mcp", { orgId: acme })).toBeNull();
  });

  it("lets any member, a viewer included, start a sign-in of their own to that server and nothing else", async () => {
    await sharedWithSignIn();
    const sign = {
      connectionId: null,
      name: "Linear",
      config: { type: "mcp" as const, url: "https://mcp.linear.app/mcp", headerName: "Authorization" },
      pending: "{}",
    };
    expect(await connections.startSignIn(inAcme("vera"), { ...sign, stateHash: "b".repeat(64) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await connections.startSignIn(inAcme("vera"), { ...sign, stateHash: "c".repeat(64) }, { ownCopy: true })).toEqual({ ok: true, data: undefined });
    expect(await connections.startSignIn(inAcme("mallory"), { ...sign, stateHash: "d".repeat(64) }, { ownCopy: true })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
  it("counts the teammate's own sign-in to that server even once they've shared it with the workspace", async () => {
    const { appId, eds } = await sharedWithSignIn();
    const alices = await signedIn("alice", "org");
    expect((await connections.open("alice", eds, "mcp", { orgId: acme }))?.id).toBe(alices);
    expect(await connections.signInNeeded("alice", eds)).toBeNull();
    expect((await appsService.get("alice", appId))?.connections.find((row) => row.id === eds)).toMatchObject({ needsSignIn: false });
  });

  it("asks the teammate, a viewer included, to sign in again when their own sign-in has expired", async () => {
    const { appId, eds } = await sharedWithSignIn();
    const veras = await signedIn("vera");
    const own = async () => (await appsService.get("vera", appId))?.connections.find((row) => row.id === eds);
    expect(await own()).toMatchObject({ needsSignIn: false, expiredOwnSignIn: null });

    await db.update(dataConnections).set({ status: "invalid" }).where(eq(dataConnections.id, veras));
    expect(await own()).toMatchObject({ needsSignIn: false, expiredOwnSignIn: veras });
    // Theirs to sign in to again, as a viewer; never Ed's.
    const sign = { name: "Linear", config: { type: "mcp" as const, url: "https://mcp.linear.app/mcp", headerName: "Authorization" }, pending: "{}" };
    expect(await connections.startSignIn(inAcme("vera"), { ...sign, connectionId: veras, stateHash: "e".repeat(64) })).toEqual({ ok: true, data: undefined });
    expect(await connections.startSignIn(inAcme("vera"), { ...sign, connectionId: eds, stateHash: "f".repeat(64) })).toMatchObject({ ok: false });
    // Ed's own sign-in isn't affected.
    expect((await appsService.get("ed", appId))?.connections.find((row) => row.id === eds)).toMatchObject({ expiredOwnSignIn: null });
  });
});

describe("sharing an app with specific teammates", () => {
  const share = (by: string, appId: string, memberId: string, access: "view" | "edit") =>
    appsService.shareWithMember(by, { id: appId, memberId, access });

  it("lets one teammate into a private app, to view or to edit, and nobody else", async () => {
    const { appId } = await app("ed");
    await seedTeam(db, "Acme", { alice: "admin", ed: "editor", vera: "viewer", eve: "editor" });
    expect(await share("ed", appId, "eve", "view")).toEqual({ ok: true, data: undefined });

    expect(await appAccess(db, "eve", appId)).toMatchObject({ access: "view", canChange: false, guest: false });
    expect(await appsService.rename("eve", { id: appId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await threads.register("eve", appId, { threadId: "thread_e", title: "Hi" })).toMatchObject({ ok: false });
    // Still private to everyone else, the admin included.
    expect(await appAccess(db, "alice", appId)).toBeNull();
    expect(await appAccess(db, "vera", appId)).toBeNull();
    expect((await appsService.get("ed", appId))?.teamAccess).toBe("private");

    // Changing what they have, in place.
    expect(await share("ed", appId, "eve", "edit")).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "eve", appId)).toMatchObject({ access: "edit", canChange: true, guest: false });
    expect(await appsService.rename("eve", { id: appId, name: "Ours" })).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(appMembers)).toHaveLength(1);
    await db.delete(orgMembers).where(eq(orgMembers.userId, "eve"));
  });

  it("gives the higher of what they were given and what the workspace has", () => {
    const theirs = { userId: "ed", teamAccess: "view" as AppTeamAccess };
    expect(accessFor(theirs, "alice", "editor", "edit")).toBe("edit");
    expect(accessFor({ ...theirs, teamAccess: "edit" }, "alice", "editor", "view")).toBe("edit");
    expect(accessFor({ ...theirs, teamAccess: "private" }, "alice", "editor", "view")).toBe("view");
    expect(accessFor({ ...theirs, teamAccess: "private" }, "alice", "editor", null)).toBeNull();
    // The owner is the owner whatever a row says.
    expect(accessFor(theirs, "ed", "editor", "view")).toBe("owner");
  });

  it("never lifts a viewer past viewing", async () => {
    const { appId } = await app("ed");
    expect(await share("ed", appId, "vera", "edit")).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await appAccess(db, "vera", appId)).toBeNull();
    expect(await share("ed", appId, "vera", "view")).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "vera", appId)).toMatchObject({ access: "view", canChange: false });

    // Someone given edit who is later made a viewer keeps the row, and only views.
    await share("ed", appId, "alice", "edit");
    await seedTeam(db, "Acme", { alice: "viewer" });
    expect(accessFor({ userId: "ed", teamAccess: "private" }, "alice", "viewer", "edit")).toBe("view");
    expect(await appAccess(db, "alice", appId)).toMatchObject({ access: "view", canChange: false });
    expect(await appsService.rename("alice", { id: appId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("is for whoever can change the app, and only names members of its workspace", async () => {
    const { appId } = await app("ed");
    // Nobody who can't open it, or can only view it.
    expect(await share("alice", appId, "alice", "edit")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await share("mallory", appId, "mallory", "edit")).toMatchObject({ ok: false, error: { code: "not_found" } });
    await share("ed", appId, "alice", "view");
    expect(await share("alice", appId, "alice", "edit")).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await share("alice", appId, "vera", "view")).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.unshareWithMember("alice", { id: appId, memberId: "alice" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.teammates("alice", appId)).toEqual([]);

    // Never someone outside the workspace, and never the owner.
    expect(await share("ed", appId, "mallory", "view")).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await appAccess(db, "mallory", appId)).toBeNull();
    expect(await share("ed", appId, "ed", "view")).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await share("ed", appId, "nobody", "view")).toMatchObject({ ok: false, error: { code: "validation" } });

    // Someone given edit can share it on, like a shared document.
    await share("ed", appId, "alice", "edit");
    expect(await share("alice", appId, "vera", "view")).toEqual({ ok: true, data: undefined });
    expect((await appsService.teammates("ed", appId)).map(({ userId, role, access }) => ({ userId, role, access }))).toEqual([
      { userId: "alice", role: "admin", access: "edit" },
      { userId: "vera", role: "viewer", access: "view" },
    ]);
    // The ones it isn't shared with yet are listed too, to pick from. Never the owner.
    await appsService.unshareWithMember("ed", { id: appId, memberId: "vera" });
    expect((await appsService.teammates("ed", appId)).map(({ userId, access }) => ({ userId, access }))).toEqual([
      { userId: "alice", access: "edit" },
      { userId: "vera", access: null },
    ]);
  });

  it("shows the app in their workspace lists, and counts it as shared", async () => {
    const { appId, connectionId } = await app("ed");
    expect(await appsService.tree(inAcme("alice"))).toEqual([]);
    await share("ed", appId, "alice", "edit");

    expect((await appsService.list(inAcme("alice"))).map(({ id, mine }) => ({ id, mine }))).toEqual([{ id: appId, mine: false }]);
    expect((await appsService.tree(inAcme("alice"))).map(({ id, mine, canChange }) => ({ id, mine, canChange }))).toEqual([
      { id: appId, mine: false, canChange: true },
    ]);
    expect(await appsService.tree(inAcme("vera"))).toEqual([]);
    expect((await appsService.get("ed", appId))?.teammateCount).toBe(1);
    // It isn't a guest's app: it shows in the workspace, not under "Shared with you".
    expect(await appsService.sharedWithGuest("alice")).toEqual([]);
    // The connections page names it for them, and still hides it from the rest.
    const usedBy = async (userId: string) => (await connections.list(inAcme(userId))).find((row) => row.id === connectionId)?.apps.map((row) => row.id);
    expect(await usedBy("alice")).toEqual([appId]);
    expect(await usedBy("vera")).toEqual([]);
  });

  it("tells OpenUI Cloud the group their access earns", async () => {
    const { appId } = await app("ed");
    const groups = appGroups(appId);
    await share("ed", appId, "alice", "edit");
    await share("ed", appId, "vera", "view");
    const identity = async (userId: string) => cloudIdentity(userId, (await appAccess(db, userId, appId))!);
    expect(await identity("alice")).toEqual({ userId: "alice", groupIds: [groups.edit] });
    expect(await identity("vera")).toEqual({ userId: "vera", groupIds: [groups.view] });
  });

  it("ends when it's taken back, and when they leave the workspace", async () => {
    const { appId } = await app("ed");
    await share("ed", appId, "alice", "edit");
    await share("ed", appId, "vera", "view");

    expect(await appsService.unshareWithMember("ed", { id: appId, memberId: "vera" })).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "vera", appId)).toBeNull();

    // Removed from the workspace: no access, and nothing waiting if they're added back.
    await seedTeam(db, "Acme", { alice: "editor", ed: "admin", vera: "viewer" });
    expect(await orgsService.removeMember("ed", { orgId: acme, userId: "alice" })).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "alice", appId)).toBeNull();
    expect(await db.select().from(appMembers)).toEqual([]);
    await seedTeam(db, "Acme", { alice: "editor" });
    expect(await appAccess(db, "alice", appId)).toBeNull();

    // Leaving does the same.
    await share("ed", appId, "alice", "edit");
    expect(await orgsService.leave("alice", { orgId: acme })).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(appMembers)).toEqual([]);
  });

  it("never reaches an app of another workspace through a row", async () => {
    const { appId } = await app("ed");
    // A row for someone who isn't a member counts for nothing.
    await db.insert(appMembers).values({ appId, userId: "mallory", access: "edit", addedBy: "ed" });
    expect(await appAccess(db, "mallory", appId)).toBeNull();
    expect(await appsService.get("mallory", appId)).toBeNull();
    expect(await appsService.tree(workspaceOf("mallory"))).toEqual([]);
    expect(await appsService.list(inAcme("mallory"))).toEqual([]);
    expect((await appsService.get("ed", appId))?.teammateCount).toBe(0);
  });

  it("keeps teammates out of the guest list", async () => {
    const { appId } = await app("ed");
    expect(await appsService.addGuest("ed", { id: appId, email: "Alice@example.com" })).toMatchObject({
      ok: false,
      error: { code: "validation", field: "email" },
    });
    expect(await appAccess(db, "alice", appId)).toBeNull();
  });
});

describe("guests of an app", () => {
  /** Ed's private app in Acme, with Gina (in no workspace with them) let in by email. */
  async function withGuest() {
    const shared = await app("ed");
    expect(await appsService.addGuest("ed", { id: shared.appId, email: "Gina@Example.com" })).toEqual({ ok: true, data: undefined });
    return shared;
  }

  beforeEach(async () => {
    await seedWorkspaces(db, ["gina"]);
  });

  it("see the whole app, read-only, and nothing else of the workspace", async () => {
    const { appId } = await withGuest();
    const other = await app("ed");
    await dashboards.record("ed", appId, { artifactId: "art_g1", title: "Signups" });

    expect(await appAccess(db, "gina", appId)).toMatchObject({ access: "view", canChange: false, guest: true, orgId: acme });
    expect(await appsService.get("gina", appId)).toMatchObject({ access: "view", canChange: false, guest: true });
    expect((await dashboards.list("gina", appId)).map((row) => row.title)).toEqual(["Signups"]);
    expect(await dashboards.findByArtifact("gina", "art_g1")).toMatchObject({ appId });
    expect((await appsService.sharedWithGuest("gina")).map(({ id, canChange }) => ({ id, canChange }))).toEqual([{ id: appId, canChange: false }]);

    // Nothing else: not the workspace's other apps, its lists, or anything that changes the app.
    expect(await appsService.get("gina", other.appId)).toBeNull();
    expect(await appsService.list(inAcme("gina"))).toEqual([]);
    expect(await appsService.tree(inAcme("gina"))).toEqual([]);
    expect(await connections.list(inAcme("gina"))).toEqual([]);
    expect(await appsService.rename("gina", { id: appId, name: "Mine" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.setTeamAccess("gina", { id: appId, teamAccess: "edit" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.addGuest("gina", { id: appId, email: "friend@example.com" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.guests("gina", appId)).toEqual([]);
    expect(await threads.register("gina", appId, { threadId: "thread_g", title: "Hi" })).toMatchObject({ ok: false });
    expect(await dashboards.record("gina", appId, { artifactId: "art_g2", title: "Extra" })).toBeNull();
  });

  it("are whoever signs in with that email, and nobody else", async () => {
    const { appId } = await withGuest();
    expect(await appAccess(db, "mallory", appId)).toBeNull();
    expect(await appsService.sharedWithGuest("mallory")).toEqual([]);
    // The team's own members are unaffected: the app is still private to them.
    expect(await appAccess(db, "alice", appId)).toBeNull();
  });

  it("are told to OpenUI Cloud as holding the app's view group", async () => {
    const { appId } = await withGuest();
    expect(cloudIdentity("gina", (await appAccess(db, "gina", appId))!)).toEqual({ userId: "gina", groupIds: [appGroups(appId).view] });
  });

  it("query through the connections the app uses, and no others", async () => {
    const { appId, connectionId } = await withGuest();
    const unused = await keyed("alice", "Unused");

    expect(await connections.open("gina", connectionId, "posthog", { orgId: acme, appId })).toMatchObject({ id: connectionId });
    // Not a connection the app doesn't use, not without the app, not through another app.
    expect(await connections.open("gina", unused, "posthog", { orgId: acme, appId })).toBeNull();
    expect(await connections.open("gina", connectionId, "posthog", { orgId: acme })).toBeNull();
    const other = await app("ed");
    expect(await connections.open("gina", other.connectionId, "posthog", { orgId: acme, appId })).toBeNull();
    expect(await connections.open("mallory", connectionId, "posthog", { orgId: acme, appId })).toBeNull();
  });

  it("can't be added to an app that uses a personal sign-in", async () => {
    const { appId } = await app("ed");
    const eds = await signedIn("ed");
    await appsService.addConnection("ed", { appId, connectionId: eds });
    const result = await appsService.addGuest("ed", { id: appId, email: "gina@example.com" });
    expect(result).toMatchObject({ ok: false, error: { code: "validation", field: "email" } });
    expect(result.ok ? "" : result.error.message).toContain("Linear");
    expect(await appAccess(db, "gina", appId)).toBeNull();
  });

  it("never query through a personal sign-in added to the app later", async () => {
    const { appId } = await withGuest();
    const eds = await signedIn("ed");
    await appsService.addConnection("ed", { appId, connectionId: eds });
    expect(await connections.open("gina", eds, "mcp", { orgId: acme, appId })).toBeNull();
    expect(await connections.signInNeeded("gina", eds)).toBeNull();
  });

  it("are invited by anyone who can change the app, and by nobody who can only view it", async () => {
    const { appId } = await app("ed", "edit");
    expect(await appsService.addGuest("vera", { id: appId, email: "gina@example.com" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await appsService.addGuest("mallory", { id: appId, email: "gina@example.com" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await appsService.addGuest("alice", { id: appId, email: "not an email" })).toMatchObject({ ok: false, error: { code: "validation", field: "email" } });
    expect(await appsService.addGuest("alice", { id: appId, email: "gina@example.com" })).toEqual({ ok: true, data: undefined });
    expect(await appsService.addGuest("ed", { id: appId, email: "GINA@example.com" })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect((await appsService.guests("ed", appId)).map(({ email, invitedBy }) => ({ email, invitedBy }))).toEqual([
      { email: "gina@example.com", invitedBy: "alice@example.com" },
    ]);
    expect((await appsService.get("ed", appId))?.guestCount).toBe(1);
  });

  it("lose access the moment they're removed", async () => {
    const { appId, connectionId } = await withGuest();
    expect(await appsService.removeGuest("ed", { id: appId, email: "gina@example.com" })).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "gina", appId)).toBeNull();
    expect(await connections.open("gina", connectionId, "posthog", { orgId: acme, appId })).toBeNull();
    expect(await appsService.sharedWithGuest("gina")).toEqual([]);
  });

  it("are all visible to the workspace's admins, who can remove any of them, even on an app they can't open", async () => {
    const { appId } = await withGuest();
    expect(await appsService.get("alice", appId)).toBeNull();
    expect((await appsService.workspaceGuests(inAcme("alice"))).map(({ appId: id, email, invitedBy }) => ({ id, email, invitedBy }))).toEqual([
      { id: appId, email: "gina@example.com", invitedBy: "ed@example.com" },
    ]);
    // Oversight is for admins.
    for (const member of ["ed", "vera", "mallory", "gina"]) expect(await appsService.workspaceGuests(inAcme(member))).toEqual([]);
    expect(await appsService.removeGuest("vera", { id: appId, email: "gina@example.com" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await appsService.removeGuest("mallory", { id: appId, email: "gina@example.com" })).toMatchObject({ ok: false, error: { code: "not_found" } });

    expect(await appsService.removeGuest("alice", { id: appId, email: "gina@example.com" })).toEqual({ ok: true, data: undefined });
    expect(await appAccess(db, "gina", appId)).toBeNull();
  });

  it("stay guests when they join the workspace, until the workspace itself opens the app", async () => {
    const { appId } = await withGuest();
    await seedTeam(db, "Acme", { gina: "editor" });
    try {
      // The workspace doesn't open this private app for her: she's still its guest, and it's listed as one.
      expect(await appAccess(db, "gina", appId)).toMatchObject({ access: "view", guest: true });
      expect((await appsService.sharedWithGuest("gina")).map((row) => row.id)).toEqual([appId]);
      expect((await appsService.tree(inAcme("gina"))).map((row) => row.id)).not.toContain(appId);

      // Once the workspace opens it, that's how she has it: listed with the workspace's apps, never both.
      await appsService.setTeamAccess("ed", { id: appId, teamAccess: "edit" });
      expect(await appAccess(db, "gina", appId)).toMatchObject({ access: "edit", guest: false });
      expect(await appsService.sharedWithGuest("gina")).toEqual([]);
      expect((await appsService.tree(inAcme("gina"))).map((row) => row.id)).toContain(appId);
    } finally {
      await db.delete(orgMembers).where(sql`${orgMembers.userId} = 'gina' and ${orgMembers.orgId} = ${acme}`);
    }
  });

  it("go with the app when it's deleted", async () => {
    const { appId } = await withGuest();
    await appsService.remove("ed", { id: appId });
    expect(await appsService.sharedWithGuest("gina")).toEqual([]);
    expect(await appsService.workspaceGuests(inAcme("alice"))).toEqual([]);
  });
});
