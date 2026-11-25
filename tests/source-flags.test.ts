import { afterEach, describe, expect, it, vi } from "vitest";

const flagOn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/analytics", () => ({ isFlagEnabled: vi.fn(async () => flagOn.value), track: vi.fn(), identifyWorkspace: vi.fn() }));

import { startSignIn } from "@/lib/connections/sign-in";
import { hiddenSources } from "@/lib/sources/flags";

const scope = { userId: "user-1", orgId: "org-1" };

describe("ads sources feature flag", () => {
  afterEach(() => {
    flagOn.value = true;
  });

  it("hides Google Ads and Meta Ads while the flag is off", async () => {
    expect(await hiddenSources(scope)).toEqual([]);
    flagOn.value = false;
    expect(await hiddenSources(scope)).toEqual(["googleads", "metaads"]);
  });

  it("refuses a new sign-in to a hidden source before reaching Composio", async () => {
    flagOn.value = false;
    for (const source of ["googleads", "metaads"]) {
      const result = await startSignIn(scope, { name: "Ads", source, sharing: "personal" });
      expect(result).toEqual({ ok: false, error: { code: "not_available", message: "This source isn't available in this workspace yet." } });
    }
  });
});

describe("isFlagEnabled", () => {
  it("is always on locally, without asking PostHog", async () => {
    const { isFlagEnabled } = await vi.importActual<typeof import("@/lib/analytics")>("@/lib/analytics");
    vi.stubEnv("VERCEL_ENV", "");
    expect(await isFlagEnabled("opendashboards-ads-sources", "user-1", "org-1")).toBe(true);
    vi.unstubAllEnvs();
  });
});
