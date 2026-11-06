"use client";

import { KitDashboard } from "@/app/(app)/kit/kit-dashboard";

import { EDGE_CASES } from "./edge-cases";

export function EdgeCasesExample() {
  return <KitDashboard source={EDGE_CASES} />;
}
