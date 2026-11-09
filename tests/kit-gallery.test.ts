import { library } from "@prism/dashboard-kit";
import { createParser } from "@openuidev/react-lang";
import { expect, it } from "vitest";

import { GALLERY } from "@/app/(app)/kit/gallery";

it("the /kit gallery parses cleanly against the dashboard kit", () => {
  const { meta } = createParser(library.toJSONSchema(), "Dashboard").parse(GALLERY.source);
  expect(meta.errors, JSON.stringify(meta.errors, null, 2)).toEqual([]);
  expect(meta.unresolved).toEqual([]);
  expect(meta.orphaned).toEqual([]);
});

it("the /kit/edge-cases program parses cleanly against the dashboard kit", async () => {
  const { EDGE_CASES } = await import("@/app/(app)/kit/edge-cases/edge-cases");
  const { meta } = createParser(library.toJSONSchema(), "Dashboard").parse(EDGE_CASES.source);
  expect(meta.errors, JSON.stringify(meta.errors, null, 2)).toEqual([]);
  expect(meta.unresolved).toEqual([]);
  expect(meta.orphaned).toEqual([]);
});
