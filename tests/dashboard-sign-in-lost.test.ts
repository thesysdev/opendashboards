import { describe, expect, it, vi } from "vitest";

import { asDataTool } from "@/lib/dashboards";
import { ToolError, type Tool } from "@/lib/tools";

/** A tool that fails the way a query on an expired sign-in does, or another way. */
const failing = (code: string): Tool => ({
  name: "mcp_call",
  description: "",
  parameters: {},
  callers: ["dashboard"],
  run: async () => {
    throw new ToolError(code, "failed");
  },
});

const options = { signal: new AbortController().signal };

describe("a dashboard data call", () => {
  it("reports a lost sign-in, even though the script may catch the error", async () => {
    const onSignInLost = vi.fn();
    await expect(asDataTool(failing("reauth_required")).execute({}, { userId: "u", appId: "a", orgId: "o", onSignInLost }, options)).rejects.toMatchObject({
      code: "reauth_required",
    });
    expect(onSignInLost).toHaveBeenCalledOnce();
  });

  it("doesn't for other failures", async () => {
    const onSignInLost = vi.fn();
    await expect(asDataTool(failing("key_rejected")).execute({}, { userId: "u", appId: "a", orgId: "o", onSignInLost }, options)).rejects.toBeTruthy();
    expect(onSignInLost).not.toHaveBeenCalled();
  });
});
