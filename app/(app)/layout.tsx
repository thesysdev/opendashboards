import type { Metadata } from "next";

/** Everything in here is a signed-in user's own; only the landing page is for crawlers. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
