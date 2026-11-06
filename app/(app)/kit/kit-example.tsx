"use client";

import { MockDashboard } from "@/components/apps/mock-dashboard";

import { GALLERY } from "./gallery";

export function KitExample() {
  return <MockDashboard source={GALLERY} />;
}
