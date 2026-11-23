import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "@/lib/db";
import { appConnections, apps, dashboards, dataConnections, orgInvites, orgMembers, orgs, users } from "@/lib/db/schema";
import { roleIn } from "@/lib/orgs/access";
import { createOrgService } from "@/lib/orgs/service";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);
const service = createOrgService({ db });

const alice = { id: "alice", email: "Alice@Example.com" };
const bob = { id: "bob", email: "bob@example.com" };
const carol = { id: "carol", email: "carol@example.com" };

async function team(name = "Acme") {
  const result = await service.create(alice, { name });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.id;
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${orgs}, ${users} CASCADE`);
  await service.ensureUser(alice);
});

afterAll(() => pool.end());

describe("signing up", () => {
  it("gives someone nobody invited a workspace of their own, named after them, once", async () => {
    await service.ensureUser(bob);
    await service.ensureUser(bob);
    expect(await service.isKnown(bob)).toBe(true);
    expect((await service.list(bob.id)).map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "bob's workspace", role: "admin" },
    ]);
  });

  it("puts someone who was invited in that workspace, and gives them none of their own", async () => {
    const orgId = await team();
    await service.invite(alice.id, { orgId, email: carol.email, role: "viewer" });

    await service.ensureUser(carol);

    expect(await service.list(carol.id)).toEqual([{ id: orgId, name: "Acme", role: "viewer" }]);
    expect(await db.select().from(orgInvites)).toEqual([]);
  });

  it("stores the email lowercased, and notices when it changes", async () => {
    const [row] = await db.select().from(users).where(eq(users.id, alice.id));
    expect(row.email).toBe("alice@example.com");
    expect(await service.isKnown(alice)).toBe(true);
    // A different email on the same account: set the user up again.
    expect(await service.isKnown({ ...alice, email: "alice@new.example.com" })).toBe(false);
  });

  it("names the workspace the migration made for someone, the first time they sign in", async () => {
    const [org] = await db.insert(orgs).values({ name: "My workspace" }).returning();
    await db.insert(orgMembers).values({ orgId: org.id, userId: bob.id, role: "admin" });

    await service.ensureUser(bob);

    expect((await service.list(bob.id)).map((row) => row.name)).toEqual(["bob's workspace"]);
  });

  it("moves rows from before workspaces into the person's own, sign-ins as personal", async () => {
    await service.ensureUser(bob);
    const [{ id: own }] = await service.list(bob.id);
    const base = { userId: bob.id, type: "mcp" as const, credentialHint: "x", status: "ok" as const, lastCheckedAt: new Date() };
    const secret = { v: 1 as const, provider: "plaintext" as const, value: "{}" };
    const mcp = { type: "mcp" as const, url: "https://mcp.example.com/mcp", headerName: "Authorization" };
    await db.insert(dataConnections).values([
      { ...base, id: crypto.randomUUID(), name: "Keyed", config: mcp, secret },
      {
        ...base,
        id: crypto.randomUUID(),
        name: "Signed in",
        config: { ...mcp, oauth: { issuer: "https://mcp.example.com", tokenEndpoint: "https://mcp.example.com/token", resource: mcp.url } },
        secret,
      },
    ]);
    await db.insert(apps).values({ userId: bob.id, name: "Old app" });

    await service.adoptOrphans(bob.id);

    const rows = await db.select().from(dataConnections).where(eq(dataConnections.userId, bob.id));
    expect(rows.map(({ name, orgId, sharing }) => ({ name, orgId, sharing })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Keyed", orgId: own, sharing: "org" },
      { name: "Signed in", orgId: own, sharing: "personal" },
    ]);
    const [app] = await db.select().from(apps).where(eq(apps.userId, bob.id));
    expect(app.orgId).toBe(own);
  });

  it("never moves someone's old rows into a workspace they were invited to", async () => {
    const orgId = await team();
    await service.invite(alice.id, { orgId, email: carol.email, role: "editor" });
    await service.ensureUser(carol);
    await db.insert(apps).values({ userId: carol.id, name: "Old app" });

    await service.adoptOrphans(carol.id);

    const [app] = await db.select().from(apps).where(eq(apps.userId, carol.id));
    expect(app.orgId).toBeNull();
  });
});

describe("workspaces", () => {
  it("makes the creator the first admin", async () => {
    const orgId = await team();
    expect(await roleIn(db, alice.id, orgId)).toBe("admin");
    expect((await service.list(alice.id)).map((org) => org.name)).toEqual(["alice's workspace", "Acme"]);
  });

  it("needs a name when one is given, and is named after the person when none is", async () => {
    expect(await service.create(alice, { name: "  " })).toMatchObject({ ok: false, error: { code: "validation", field: "name" } });
    const created = await service.create(bob);
    expect(created.ok && (await service.get(bob.id, created.data.id))?.name).toBe("bob's workspace");
  });

  it("looks like nothing to someone who isn't a member", async () => {
    const orgId = await team();
    await service.ensureUser(bob);
    expect(await service.get(bob.id, orgId)).toBeNull();
    expect(await service.invite(bob.id, { orgId, email: carol.email, role: "admin" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await service.rename(bob.id, { orgId, name: "Mine now" })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("lets people be invited into the workspace someone signed up with", async () => {
    const [{ id: own }] = await service.list(alice.id);
    await service.ensureUser(bob);
    expect(await service.invite(alice.id, { orgId: own, email: bob.email, role: "editor" })).toEqual({ ok: true, data: { status: "added" } });
    expect(await roleIn(db, bob.id, own)).toBe("editor");
  });

  it("can leave someone in no workspace at all", async () => {
    const orgId = await team();
    await service.invite(alice.id, { orgId, email: carol.email, role: "editor" });
    await service.ensureUser(carol);

    expect(await service.removeMember(alice.id, { orgId, userId: carol.id })).toEqual({ ok: true, data: undefined });

    // Still a known user, in nothing: the app asks them to create a workspace.
    expect(await service.isKnown(carol)).toBe(true);
    expect(await service.list(carol.id)).toEqual([]);
    await service.ensureUser(carol);
    expect(await service.list(carol.id)).toEqual([]);
  });
});

describe("adding people", () => {
  it("adds someone who already has an account straight away", async () => {
    const orgId = await team();
    await service.ensureUser(bob);
    expect(await service.invite(alice.id, { orgId, email: "BOB@example.com", role: "editor" })).toEqual({ ok: true, data: { status: "added" } });
    expect(await roleIn(db, bob.id, orgId)).toBe("editor");
    expect((await service.list(bob.id)).find((org) => org.id === orgId)).toMatchObject({ role: "editor" });
  });

  it("says so when they're already a member", async () => {
    const orgId = await team();
    await service.ensureUser(bob);
    await service.invite(alice.id, { orgId, email: bob.email, role: "editor" });
    expect(await service.invite(alice.id, { orgId, email: bob.email, role: "admin" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await roleIn(db, bob.id, orgId)).toBe("editor");
  });

  it("holds an invite for someone with no account, and makes them a member the first time they sign in", async () => {
    const orgId = await team();
    expect(await service.invite(alice.id, { orgId, email: carol.email, role: "viewer" })).toEqual({ ok: true, data: { status: "invited" } });
    expect((await service.get(alice.id, orgId))?.invites.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: carol.email, role: "viewer" },
    ]);

    await service.ensureUser(carol);

    expect(await roleIn(db, carol.id, orgId)).toBe("viewer");
    expect(await db.select().from(orgInvites)).toEqual([]);
  });

  it("gives nothing to someone who signs in with a different email", async () => {
    const orgId = await team();
    await service.invite(alice.id, { orgId, email: carol.email, role: "admin" });
    await service.ensureUser({ id: "mallory", email: "mallory@example.com" });
    expect(await roleIn(db, "mallory", orgId)).toBeNull();
  });

  it("lets an admin cancel an invite before it's used", async () => {
    const orgId = await team();
    await service.invite(alice.id, { orgId, email: carol.email, role: "editor" });
    expect(await service.revokeInvite(alice.id, { orgId, email: carol.email })).toEqual({ ok: true, data: undefined });
    await service.ensureUser(carol);
    expect(await roleIn(db, carol.id, orgId)).toBeNull();
  });

  it("is for admins only", async () => {
    const orgId = await team();
    await service.ensureUser(bob);
    await service.invite(alice.id, { orgId, email: bob.email, role: "editor" });
    expect(await service.invite(bob.id, { orgId, email: carol.email, role: "admin" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await service.changeRole(bob.id, { orgId, userId: bob.id, role: "admin" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await service.removeMember(bob.id, { orgId, userId: alice.id })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await service.rename(bob.id, { orgId, name: "Bob's" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});

describe("roles and leaving", () => {
  async function withBob(role: "admin" | "editor" | "viewer" = "editor") {
    const orgId = await team();
    await service.ensureUser(bob);
    await service.invite(alice.id, { orgId, email: bob.email, role });
    return orgId;
  }

  it("changes a member's role", async () => {
    const orgId = await withBob();
    expect(await service.changeRole(alice.id, { orgId, userId: bob.id, role: "viewer" })).toEqual({ ok: true, data: undefined });
    expect(await roleIn(db, bob.id, orgId)).toBe("viewer");
  });

  it("always keeps an admin", async () => {
    const orgId = await withBob();
    expect(await service.changeRole(alice.id, { orgId, userId: alice.id, role: "editor" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await service.leave(alice.id, { orgId })).toMatchObject({ ok: false, error: { code: "conflict" } });

    // With a second admin, the first can step down or leave.
    await service.changeRole(alice.id, { orgId, userId: bob.id, role: "admin" });
    expect(await service.leave(alice.id, { orgId })).toEqual({ ok: true, data: undefined });
    expect(await roleIn(db, alice.id, orgId)).toBeNull();
    expect(await roleIn(db, bob.id, orgId)).toBe("admin");
  });

  it("removes someone else, but not yourself", async () => {
    const orgId = await withBob();
    expect(await service.removeMember(alice.id, { orgId, userId: alice.id })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await service.removeMember(alice.id, { orgId, userId: bob.id })).toEqual({ ok: true, data: undefined });
    expect(await roleIn(db, bob.id, orgId)).toBeNull();
    expect(await db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId))).toHaveLength(1);
  });

  it("lets a member who isn't the last admin leave", async () => {
    const orgId = await withBob("viewer");
    expect(await service.leave(bob.id, { orgId })).toEqual({ ok: true, data: undefined });
    expect(await roleIn(db, bob.id, orgId)).toBeNull();
  });
});

describe("deleting a workspace", () => {
  /** Acme with Bob as an editor, an app of Bob's with a dashboard, and a connection that app uses. */
  async function populated() {
    const orgId = await team();
    await service.ensureUser(bob);
    await service.invite(alice.id, { orgId, email: bob.email, role: "editor" });
    await service.invite(alice.id, { orgId, email: carol.email, role: "viewer" });
    const [connection] = await db
      .insert(dataConnections)
      .values({
        id: crypto.randomUUID(),
        userId: alice.id,
        orgId,
        name: "Production",
        type: "posthog",
        config: { type: "posthog", hostKind: "posthog_us", projectId: "1" },
        secret: { v: 1, provider: "plaintext", value: "phx_x" },
        credentialHint: "phx_…x",
        status: "ok",
        lastCheckedAt: new Date(),
      })
      .returning();
    const [app] = await db.insert(apps).values({ userId: bob.id, orgId, name: "Bob's app" }).returning();
    await db.insert(appConnections).values({ appId: app.id, connectionId: connection.id });
    await db.insert(dashboards).values({ appId: app.id, userId: bob.id, artifactId: "art_bob", title: "Signups", position: 0 });
    return orgId;
  }

  it("is for admins, and only with the name retyped exactly", async () => {
    const orgId = await populated();
    expect(await service.remove(bob.id, { orgId, name: "Acme" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await service.remove("mallory", { orgId, name: "Acme" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    for (const name of ["", "acme", "Acme Inc"]) {
      expect(await service.remove(alice.id, { orgId, name })).toMatchObject({ ok: false, error: { code: "validation", field: "name" } });
      expect(await service.dashboardsToDelete(alice.id, { orgId, name })).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    expect(await service.dashboardsToDelete(bob.id, { orgId, name: "Acme" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await service.get(alice.id, orgId)).not.toBeNull();
  });

  it("names every member's dashboards to delete in OpenUI Cloud first", async () => {
    const orgId = await populated();
    expect(await service.dashboardsToDelete(alice.id, { orgId, name: "Acme" })).toEqual({ ok: true, data: { artifactIds: ["art_bob"] } });
  });

  it("removes everything in it for everyone, and nothing outside it", async () => {
    const orgId = await populated();
    const [{ id: own }] = await service.list(alice.id);
    await db.insert(apps).values({ userId: alice.id, orgId: own, name: "Alice's own app" });

    expect(await service.remove(alice.id, { orgId, name: " Acme " })).toEqual({ ok: true, data: undefined });

    expect(await db.select().from(orgs).where(eq(orgs.id, orgId))).toEqual([]);
    expect(await db.select().from(apps).where(eq(apps.orgId, orgId))).toEqual([]);
    expect(await db.select().from(dashboards)).toEqual([]);
    expect(await db.select().from(dataConnections).where(eq(dataConnections.orgId, orgId))).toEqual([]);
    expect(await db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId))).toEqual([]);
    expect(await db.select().from(orgInvites)).toEqual([]);
    // Bob is still a user, in his own workspace only; Alice keeps hers and what's in it.
    expect((await service.list(bob.id)).map((org) => org.name)).toEqual(["bob's workspace"]);
    expect((await service.list(alice.id)).map((org) => org.id)).toEqual([own]);
    expect(await db.select({ name: apps.name }).from(apps)).toEqual([{ name: "Alice's own app" }]);
  });

  it("can leave its only member in no workspace", async () => {
    const [{ id: own, name }] = await service.list(alice.id);
    expect(await service.remove(alice.id, { orgId: own, name })).toEqual({ ok: true, data: undefined });
    expect(await service.list(alice.id)).toEqual([]);
  });
});
