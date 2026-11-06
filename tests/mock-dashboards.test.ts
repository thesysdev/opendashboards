import { library } from "@prism/dashboard-kit";
import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";

import { MOCK_DASHBOARDS } from "@/lib/mock-dashboards";

const parser = createParser(library.toJSONSchema(), "Dashboard");

/** The dashboard titles seeded by scripts/db-seed.mjs: each needs a mock. */
const SEEDED_TITLES = [
  "Overview", "Acquisition", "Activation", "Weekly report", "Summary",
  "Funnel", "Drop-off by step", "Weekly cohorts", "Checklist completion",
  "Channels", "Campaigns", "Landing pages", "Usage", "Queries",
  "Sessions", "Screens", "Running", "Results", "Errors",
];

function expectClean(source: string) {
  const { meta } = parser.parse(source);
  expect(meta.errors, JSON.stringify(meta.errors, null, 2)).toEqual([]);
  expect(meta.unresolved, "references that are never defined").toEqual([]);
  expect(meta.orphaned, "statements not reachable from root").toEqual([]);
  expect(meta.incomplete).toBe(false);
  expect(source.trimStart().startsWith("root = Dashboard(")).toBe(true);
}

describe("mock dashboards", () => {
  it("cover every seeded dashboard", () => {
    expect(Object.keys(MOCK_DASHBOARDS).sort()).toEqual([...SEEDED_TITLES].sort());
  });

  for (const [title, source] of Object.entries(MOCK_DASHBOARDS)) {
    it(`"${title}" parses cleanly against the dashboard kit`, () => expectClean(source));
  }
});
