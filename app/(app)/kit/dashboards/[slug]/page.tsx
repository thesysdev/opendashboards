import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { KitDashboard } from "../../kit-dashboard";
import { MOCK_DASHBOARDS } from "../mocks";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const dashboard = MOCK_DASHBOARDS.find((candidate) => candidate.slug === slug);
  return { title: dashboard ? `${dashboard.title} · Mock dashboards` : "Mock dashboards" };
}

/** One mock dashboard, rendered as is. */
export default function MockDashboardPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <MockDashboardView params={params} />
    </Suspense>
  );
}

async function MockDashboardView({ params }: { params: Params }) {
  const { slug } = await params;
  const dashboard = MOCK_DASHBOARDS.find((candidate) => candidate.slug === slug);
  if (!dashboard) notFound();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex items-center gap-1.5 border-b px-6 py-2.5 text-sm text-muted-foreground">
        <Link href="/kit/dashboards" className="hover:text-foreground">
          Mock dashboards
        </Link>
        <ChevronRight aria-hidden className="size-3.5" />
        <span>{dashboard.app}</span>
        <ChevronRight aria-hidden className="size-3.5" />
        <span className="text-foreground">{dashboard.title}</span>
      </nav>
      <KitDashboard key={dashboard.slug} program={dashboard.program} />
    </div>
  );
}
