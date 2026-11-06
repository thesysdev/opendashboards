"use client";

import { MockDashboard } from "@/components/apps/mock-dashboard";

import { EDGE_CASES } from "./edge-cases";

export function EdgeCasesExample() {
  return <MockDashboard source={EDGE_CASES} />;
}
