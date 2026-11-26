import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, dataConnections, pendingSignIns } from "@/lib/db/schema";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { availableSources } from "@/lib/sources/available";
import { CONNECTION_TYPES } from "@/lib/sources/catalog";
import { COMPOSIO_SIGN_IN } from "@/lib/sources/composio/catalog";
import { mcpSource } from "@/lib/sources/mcp/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { seedWorkspaces, workspaceOf } from "./orgs";

describe("which sources are available", () => {
  const composio = { COMPOSIO_API_KEY: "key", COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID: "ac_g", COMPOSIO_METAADS_AUTH_CONFIG_ID: "ac_m" };
  const missingWith = (env: Record<string, string>) => {
    for (const name of Object.keys(composio)) vi.stubEnv(name, env[name] ?? "");
    try {
      const available = availableSources();
      return CONNECTION_TYPES.filter((type) => !available.includes(type));
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("leaves out a source this deployment isn't set up for", () => {
    expect(missingWith({})).toEqual(["googleads", "metaads"]);
    // An auth config for one toolkit sets up only that one.
    expect(missingWith({ COMPOSIO_API_KEY: "key", COMPOSIO_METAADS_AUTH_CONFIG_ID: "ac_m" })).toEqual(["googleads"]);
    expect(missingWith(composio)).toEqual([]);
  });
});

describe("sources that aren't available", () => {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const service = createConnectionService({
    db,
    secrets: () => plaintextSecretBox,
    sources: () => ({ ...mcpSource, test: async () => [] }) as unknown as ConnectionSource,
    availableSources: () => CONNECTION_TYPES.filter((type) => type !== "googleads" && type !== "mcp"),
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
    await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${pendingSignIns} CASCADE`);
    await seedWorkspaces(db, ["alice"]);
  });

  afterAll(() => pool.end());

  it("aren't offered", () => {
    const offered = service.sourceOptions().map((option) => option.type);
    expect(offered).not.toContain("googleads");
    expect(offered).not.toContain("mcp");
    expect(offered).toContain("metaads");
  });

  it("can't be added, by key or by signing in", async () => {
    const notAvailable = { ok: false, error: { code: "not_available", message: "This source isn't set up on this OpenDashboards." } };
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
