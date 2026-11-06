import type { Metadata } from "next";

import { EdgeCasesExample } from "./edge-cases-example";

export const metadata: Metadata = { title: "Dashboard kit · edge cases" };

/** Development page: every dashboard-kit component with degenerate data. */
export default function EdgeCasesPage() {
  return (
    <div className="flex h-full flex-col">
      <EdgeCasesExample />
    </div>
  );
}
