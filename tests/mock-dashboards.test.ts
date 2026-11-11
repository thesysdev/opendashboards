import { library } from "@opendashboards/dashboard-kit";
import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";

import { MOCK_DASHBOARDS } from "@/app/(app)/kit/dashboards/mocks";

const parser = createParser(library.toJSONSchema(), "Dashboard");

function expectClean(source: string) {
  const { meta } = parser.parse(source);
  expect(meta.errors, JSON.stringify(meta.errors, null, 2)).toEqual([]);
  expect(meta.unresolved, "references that are never defined").toEqual([]);
  expect(meta.orphaned, "statements not reachable from root").toEqual([]);
  expect(meta.incomplete).toBe(false);
  expect(source.trimStart().startsWith("root = Dashboard(")).toBe(true);
}

describe("mock dashboards (/kit/dashboards)", () => {
  it("have unique slugs", () => {
    const slugs = MOCK_DASHBOARDS.map((dashboard) => dashboard.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const { app, title, program } of MOCK_DASHBOARDS) {
    it(`${app} / ${title} parses cleanly against the dashboard kit`, () => expectClean(program.source));
  }
});
