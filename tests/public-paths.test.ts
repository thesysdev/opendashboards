import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";

describe("isPublicPath", () => {
  it("lets the landing page and its images through", () => {
    for (const path of [
      "/",
      "/icon.svg",
      "/shiro-logo.svg",
      "/opendashboards/revenue-light.png",
      "/brand-icons/postgresql-solid.png",
      "/shaders/faded-dither-light-wide.webp",
    ]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("keeps the app and the API behind sign-in", () => {
    for (const path of ["/apps", "/apps/123", "/connections", "/api/interpreter", "/api/frontend-token", "/api/apps/123/chat"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("matches exactly, not by prefix or look-alike", () => {
    for (const path of [
      "",
      "//",
      "/.",
      "/./apps",
      "/icon.svg/apps",
      "/shiro-logo.svg/",
      "/ICON.SVG",
      "/opendashboards",
      "/opendashboards/",
      "/opendashboards/../apps",
      "/opendashboards/..%2Fapps",
      "/opendashboards/%2e%2e/apps",
      "/shaders/..\\apps",
      "/shaders//apps",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});
