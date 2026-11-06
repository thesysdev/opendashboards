import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The /kit pages (component gallery and edge cases) are for developing the
 * dashboard kit. They exist only in development; production builds 404.
 */
export default function KitLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
