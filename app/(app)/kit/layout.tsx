import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/config";

/**
 * The /kit pages (component gallery, edge cases, mock dashboards) are for
 * developing the dashboard kit. Each environment's config says whether they
 * exist; where they don't, they 404.
 */
export default function KitLayout({ children }: { children: ReactNode }) {
  if (!config().kitPages) notFound();
  return children;
}
