import { LayoutGridIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Apps" };

export default function AppsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <PageHeader
        title="Apps"
        description="Apps group live dashboards built on one of your data connections."
      />
      <EmptyState
        icon={LayoutGridIcon}
        title="Apps are coming soon"
        description="Add a data connection now, and you'll be able to build apps on it."
      />
    </div>
  );
}
