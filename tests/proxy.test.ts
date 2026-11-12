import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const request = (path: string, init?: { method?: string; headers?: Record<string, string> }) =>
  new NextRequest(new URL(path, "http://localhost:3000"), init);

/** NextResponse.next() marks itself with this header; a rejection is a plain response. */
const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy, with the gateway's check on and nobody signed in", () => {
  beforeEach(() => {
    // Locally, setting SUPABASE_URL turns the check on; no request below carries a token.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets anyone read the home page", async () => {
    expect(passes(await proxy(request("/")))).toBe(true);
    expect(passes(await proxy(request("/", { method: "HEAD" })))).toBe(true);
  });

  it("lets a token that doesn't check out read the home page as a signed-out visitor", async () => {
    expect(passes(await proxy(request("/", { headers: { authorization: "Bearer forged" } })))).toBe(true);
  });

  it("refuses anything but reading the home page: Server Actions post to it", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await proxy(request("/", { method }))).status, method).toBe(401);
    }
  });

  it("serves what crawlers and link previews fetch", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon.svg", "/shiro-logo.svg"]) {
      expect(passes(await proxy(request(path))), path).toBe(true);
    }
  });

  it("refuses every other page, and paths that only start like a public one", async () => {
    for (const path of ["/apps", "/apps/a1", "/connections", "/kit", "/icons", "/icon.svg/x", "/robots.txt.bak"]) {
      expect((await proxy(request(path))).status, path).toBe(401);
    }
  });

  it("refuses the API and Server Actions on other pages", async () => {
    expect((await proxy(request("/api/apps/a1/threads"))).status).toBe(401);
    expect((await proxy(request("/api/frontend-token", { method: "POST" }))).status).toBe(401);
    expect((await proxy(request("/connections", { method: "POST" }))).status).toBe(401);
  });
});

describe("proxy, as the local dev user", () => {
  it("lets everything through", async () => {
    for (const path of ["/", "/connections", "/apps/a1", "/api/apps/a1/threads"]) {
      expect(passes(await proxy(request(path))), path).toBe(true);
    }
    expect(passes(await proxy(request("/", { method: "POST" })))).toBe(true);
  });
});
