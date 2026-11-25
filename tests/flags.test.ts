import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, dataConnections, mcpOAuthSignIns } from "@/lib/db/schema";
import { getFlags } from "@/lib/flags";
import { createPostHogFlags } from "@/lib/flags/posthog";
import { createStaticFlags } from "@/lib/flags/static";
import { FLAGS } from "@/lib/flags/types";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { COMPOSIO_SIGN_IN } from "@/lib/sources/composio/catalog";
import { hiddenSources } from "@/lib/sources/flags";
import { mcpSource } from "@/lib/sources/mcp/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { seedWorkspaces, workspaceOf } from "./orgs";

const scope = { userId: "user-1", orgId: "org-1" };

describe("flag providers", () => {
  it("static: every flag on except those turned off", async () => {
    expect(await createStaticFlags().isEnabled(FLAGS.adsSources, scope)).toBe(true);
    expect(await createStaticFlags([FLAGS.adsSources]).isEnabled(FLAGS.adsSources, scope)).toBe(false);
  });

  it("posthog: asks for one flag, for the user in their workspace's group", async () => {
    const evaluateFlags = vi.fn(async () => ({ isEnabled: (key: string) => key === FLAGS.adsSources }));
    const flags = createPostHogFlags({ evaluateFlags } as never, { timeoutMs: 1_000 });
    expect(await flags.isEnabled(FLAGS.adsSources, scope)).toBe(true);
    expect(evaluateFlags).toHaveBeenCalledWith("user-1", { groups: { opendash_org: "org-1" }, flagKeys: [FLAGS.adsSources] });
  });

  it("posthog: a flag it can't answer for, or not in time, is off", async () => {
    const failing = createPostHogFlags({ evaluateFlags: async () => Promise.reject(new Error("down")) } as never, { timeoutMs: 1_000 });
    expect(await failing.isEnabled(FLAGS.adsSources, scope)).toBe(false);
    const slow = createPostHogFlags({ evaluateFlags: () => new Promise(() => {}) } as never, { timeoutMs: 5 });
    expect(await slow.isEnabled(FLAGS.adsSources, scope)).toBe(false);
  });

  it("uses PostHog only where there's a PostHog client: our production deployment", () => {
    expect(getFlags({ evaluateFlags: vi.fn() } as never).provider).toBe("posthog");
    expect(getFlags(null).provider).toBe("static");
    // Tests, like local development, have no PostHog key.
    expect(getFlags().provider).toBe("static");
  });

  it("hides Google Ads and Meta Ads while their flag is off", async () => {
    expect(await hiddenSources(scope, createStaticFlags())).toEqual([]);
    expect(await hiddenSources(scope, createStaticFlags([FLAGS.adsSources]))).toEqual(["googleads", "metaads"]);
  });
});

describe("sources not on offer", () => {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const service = createConnectionService({
    db,
    secrets: () => plaintextSecretBox,
    sources: () => ({ ...mcpSource, test: async () => [] }) as unknown as ConnectionSource,
    notOffered: async () => ["googleads", "mcp"],
  });
  const alice = workspaceOf("alice");
  const signIn = (connectionId: string | null) => ({
    stateHash: crypto.randomUUID(),
    connectionId,
    name: "Ads",
    config: { type: "googleads" as const, ...COMPOSIO_SIGN_IN },
    pending: "{}",
    sharing: "personal" as const,
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${mcpOAuthSignIns} CASCADE`);
    await seedWorkspaces(db, ["alice"]);
  });

  afterAll(() => pool.end());

  it("aren't offered", async () => {
    const offered = (await service.offeredSources(alice)).map((option) => option.type);
    expect(offered).not.toContain("googleads");
    expect(offered).not.toContain("mcp");
    expect(offered).toContain("metaads");
  });

  it("can't be added, by key or by signing in", async () => {
    const notAvailable = { ok: false, error: { code: "not_available", message: "This source isn't available in this workspace yet." } };
    expect(await service.create(alice, { type: "mcp", name: "Key", url: "https://mcp.example.com/mcp", headerName: "Authorization", apiKey: "k" })).toEqual(notAvailable);
    expect(await service.startSignIn(alice, signIn(null))).toEqual(notAvailable);
  });

  it("can still be signed in to when the connection is already here", async () => {
    const [connection] = await db
      .insert(dataConnections)
      .values({
        id: crypto.randomUUID(),
        userId: "alice",
        orgId: alice.orgId,
        name: "Ads",
        type: "googleads",
        config: { type: "googleads", ...COMPOSIO_SIGN_IN },
        secret: null,
        credentialHint: "",
        status: "ok",
        lastCheckedAt: new Date(),
        sharing: "personal",
      })
      .returning();
    expect(await service.startSignIn(alice, signIn(connection.id))).toEqual({ ok: true, data: undefined });
  });
});
