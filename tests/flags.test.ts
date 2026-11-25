import { afterEach, describe, expect, it, vi } from "vitest";

import { createStaticFlags } from "@/lib/flags/static";
import { FLAGS } from "@/lib/flags/types";

const off = vi.hoisted(() => ({ flags: [] as string[] }));
vi.mock("@/lib/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags")>()),
  getFlags: () => createStaticFlags(off.flags as never),
}));

import { startSignIn } from "@/lib/connections/sign-in";
import { createPostHogFlags } from "@/lib/flags/posthog";
import { hiddenSources } from "@/lib/sources/flags";

const scope = { userId: "user-1", orgId: "org-1" };

afterEach(() => {
  off.flags = [];
});

describe("flag providers", () => {
  it("static: every flag on except those turned off", async () => {
    expect(await createStaticFlags().isEnabled(FLAGS.adsSources, scope)).toBe(true);
    expect(await createStaticFlags([FLAGS.adsSources]).isEnabled(FLAGS.adsSources, scope)).toBe(false);
  });

  it("posthog: asks for one flag, for the user in their workspace's group", async () => {
    const evaluateFlags = vi.fn(async () => ({ isEnabled: (key: string) => key === FLAGS.adsSources }));
    const flags = createPostHogFlags({ evaluateFlags } as never);
    expect(await flags.isEnabled(FLAGS.adsSources, scope)).toBe(true);
    expect(evaluateFlags).toHaveBeenCalledWith("user-1", { groups: { opendash_org: "org-1" }, flagKeys: [FLAGS.adsSources] });
  });

  it("posthog: a flag it can't answer for is off", async () => {
    const flags = createPostHogFlags({ evaluateFlags: async () => Promise.reject(new Error("down")) } as never);
    expect(await flags.isEnabled(FLAGS.adsSources, scope)).toBe(false);
  });
});

describe("getFlags", () => {
  it("uses PostHog only where there's a PostHog client: our production deployment", async () => {
    const { getFlags } = await vi.importActual<typeof import("@/lib/flags")>("@/lib/flags");
    expect(getFlags({ evaluateFlags: vi.fn() } as never).provider).toBe("posthog");
    expect(getFlags(null).provider).toBe("static");
    // Tests, like local development, have no PostHog key.
    expect(getFlags().provider).toBe("static");
  });
});

describe("ads sources flag", () => {
  it("hides Google Ads and Meta Ads while the flag is off", async () => {
    expect(await hiddenSources(scope, createStaticFlags())).toEqual([]);
    expect(await hiddenSources(scope, createStaticFlags([FLAGS.adsSources]))).toEqual(["googleads", "metaads"]);
  });

  it("refuses a new sign-in to a hidden source before reaching Composio", async () => {
    off.flags = [FLAGS.adsSources];
    for (const source of ["googleads", "metaads"]) {
      const result = await startSignIn(scope, { name: "Ads", source, sharing: "personal" });
      expect(result).toEqual({ ok: false, error: { code: "not_available", message: "This source isn't available in this workspace yet." } });
    }
  });
});
