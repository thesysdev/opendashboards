import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { appConnections, apps, dataConnections } from "@/lib/db/schema";
import { PostHogError } from "@/lib/posthog/client";
import type { SecretBox } from "@/lib/secrets";
import { createKmsSecretBox } from "@/lib/secrets/kms";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);

const VALID = {
  name: "Production",
  hostKind: "posthog_us",
  projectId: "12345",
  apiKey: "phx_abcdefghijklmnopqrstuvwxyz1234",
};

function makeService(overrides: { secrets?: SecretBox; test?: () => Promise<void> } = {}) {
  const testConnection = vi.fn(overrides.test ?? (async () => {}));
  const service = createConnectionService({
    db,
    secrets: () => overrides.secrets ?? plaintextSecretBox,
    testConnection,
  });
  return { service, testConnection };
}

async function createOk(userId: string, input = VALID) {
  const { service } = makeService();
  const result = await service.create(userId, input);
  if (!result.ok) throw new Error(`create failed: ${result.error.code}`);
  return result.data.id;
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections} CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

describe("create", () => {
  it("tests the key, then saves a connection without exposing the key", async () => {
    const { service, testConnection } = makeService();
    const result = await service.create("alice", VALID);
    expect(result.ok).toBe(true);
    expect(testConnection).toHaveBeenCalledWith({
      hostKind: "posthog_us",
      projectId: "12345",
      apiKey: VALID.apiKey,
    });

    const [listed] = await service.list("alice");
    expect(listed).toMatchObject({ name: "Production", status: "ok", keyHint: "phx_…1234" });
    expect(JSON.stringify(listed)).not.toContain(VALID.apiKey);
  });

  it("saves nothing when PostHog rejects the key, and points at the key field", async () => {
    const { service } = makeService({
      test: async () => {
        throw new PostHogError("invalid_key", 403);
      },
    });
    const result = await service.create("alice", VALID);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_key", field: "apiKey" } });
    expect(await service.list("alice")).toEqual([]);
  });

  it("rejects unexpected fields such as a host or URL", async () => {
    const { service, testConnection } = makeService();
    const result = await service.create("alice", { ...VALID, url: "http://169.254.169.254" });
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("validates each field", async () => {
    const { service } = makeService();
    for (const [field, value] of [
      ["name", "  "],
      ["hostKind", "posthog_internal"],
      ["projectId", "12a"],
      ["apiKey", "sk_live_123"],
    ] as const) {
      const result = await service.create("alice", { ...VALID, [field]: value });
      expect(result).toMatchObject({ ok: false, error: { code: "validation", field } });
    }
  });

  it("reports missing secret storage without calling PostHog", async () => {
    const { service, testConnection } = makeService({ secrets: createKmsSecretBox("arn:test") });
    const result = await service.create("alice", VALID);
    expect(result).toMatchObject({ ok: false, error: { code: "secret_storage_unavailable" } });
    expect(testConnection).not.toHaveBeenCalled();
  });
});

describe("ownership", () => {
  it("never shows or changes another user's connection", async () => {
    const id = await createOk("alice");
    const { service, testConnection } = makeService();

    expect(await service.list("bob")).toEqual([]);
    for (const result of [
      await service.retest("bob", { id }),
      await service.rename("bob", { id, name: "Hijacked" }),
      await service.replaceKey("bob", { id, apiKey: VALID.apiKey }),
      await service.remove("bob", { id }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect(testConnection).not.toHaveBeenCalled();

    const [still] = await service.list("alice");
    expect(still).toMatchObject({ id, name: "Production" });
  });

  it("treats a malformed id as not found", async () => {
    const { service } = makeService();
    expect(await service.remove("alice", { id: "not-a-uuid" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("retest", () => {
  it("records ok, invalid and unavailable outcomes", async () => {
    const id = await createOk("alice");

    const failing = makeService({
      test: async () => {
        throw new PostHogError("missing_scope", 403);
      },
    });
    expect(await failing.service.retest("alice", { id })).toMatchObject({
      ok: false,
      error: { code: "missing_scope" },
    });
    expect((await failing.service.list("alice"))[0].status).toBe("invalid");

    const down = makeService({
      test: async () => {
        throw new PostHogError("unavailable");
      },
    });
    await down.service.retest("alice", { id });
    expect((await down.service.list("alice"))[0].status).toBe("unavailable");

    const fine = makeService();
    expect(await fine.service.retest("alice", { id })).toEqual({ ok: true, data: { status: "ok" } });
    expect((await fine.service.list("alice"))[0].status).toBe("ok");
  });

  it("marks a plaintext row invalid under KMS instead of using it", async () => {
    const id = await createOk("alice");
    const { service, testConnection } = makeService({ secrets: createKmsSecretBox("arn:test") });

    expect(await service.retest("alice", { id })).toMatchObject({
      ok: false,
      error: { code: "key_reentry_required" },
    });
    expect(testConnection).not.toHaveBeenCalled();
    expect((await service.list("alice"))[0].status).toBe("invalid");
  });

  it("caches the decrypted key and drops it when the key is replaced", async () => {
    const id = await createOk("alice");
    const open = vi.fn(plaintextSecretBox.open);
    const secrets: SecretBox = { ...plaintextSecretBox, open };
    const { service, testConnection } = makeService({ secrets });

    await service.retest("alice", { id });
    await service.retest("alice", { id });
    expect(open).toHaveBeenCalledTimes(1);

    const newKey = "phx_zyxwvutsrqponmlkjihgfedcba9876";
    expect(await service.replaceKey("alice", { id, apiKey: newKey })).toEqual({
      ok: true,
      data: undefined,
    });
    await service.retest("alice", { id });
    expect(open).toHaveBeenCalledTimes(2);
    expect(testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: newKey }));
  });
});

describe("replaceKey", () => {
  it("keeps the old key when the new one fails, and never changes the host", async () => {
    const id = await createOk("alice");
    const { service, testConnection } = makeService({
      test: async () => {
        throw new PostHogError("invalid_key", 403);
      },
    });

    const result = await service.replaceKey("alice", {
      id,
      apiKey: "phx_badbadbadbadbadbadbad1",
      hostKind: "posthog_eu",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(testConnection).not.toHaveBeenCalled();

    const failed = await service.replaceKey("alice", { id, apiKey: "phx_badbadbadbadbadbadbad1" });
    expect(failed).toMatchObject({ ok: false, error: { code: "invalid_key" } });
    const [row] = await service.list("alice");
    expect(row).toMatchObject({ keyHint: "phx_…1234", hostKind: "posthog_us" });
  });
});

describe("rename and remove", () => {
  it("renames", async () => {
    const id = await createOk("alice");
    const { service } = makeService();
    expect(await service.rename("alice", { id, name: "  Staging  " })).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await service.list("alice"))[0].name).toBe("Staging");
  });

  it("refuses to delete a connection an app uses, and lists the apps", async () => {
    const id = await createOk("alice");
    const [app] = await db.insert(apps).values({ userId: "alice", name: "Growth" }).returning();
    await db.insert(appConnections).values({ appId: app.id, connectionId: id });
    const { service } = makeService();

    expect(await service.remove("alice", { id })).toMatchObject({
      ok: false,
      error: { code: "in_use", apps: [{ name: "Growth" }] },
    });
    expect(await service.list("alice")).toHaveLength(1);
  });

  it("deletes an unused connection", async () => {
    const id = await createOk("alice");
    const { service } = makeService();
    expect(await service.remove("alice", { id })).toEqual({ ok: true, data: undefined });
    expect(await service.list("alice")).toEqual([]);
  });
});
