import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/oauth/client-metadata.json/route";

/** prod's settings, with the client metadata document switched on or off. */
const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, config: () => ({ env: "prod", ...actual.settingsFor("prod"), mcpClientMetadataDocument: flag.on }) };
});

describe("GET /oauth/client-metadata.json", () => {
  beforeEach(() => {
    flag.on = false;
  });

  it("serves the document at its own URL, naming the sign-in callback", async () => {
    flag.on = true;
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await response.json()).toMatchObject({
      client_id: "https://opendashboards.com/oauth/client-metadata.json",
      redirect_uris: ["https://opendashboards.com/api/mcp/oauth/callback"],
      token_endpoint_auth_method: "none",
    });
  });

  it("isn't there where it's switched off", () => {
    expect(GET().status).toBe(404);
  });
});
