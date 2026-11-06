"use client";

import { KitDashboard } from "@/app/(app)/kit/kit-dashboard";

import { GALLERY } from "./gallery";

export function KitExample() {
  return <KitDashboard source={GALLERY} />;
}
