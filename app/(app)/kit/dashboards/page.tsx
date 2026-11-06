import type { Metadata } from "next";
import Link from "next/link";

import { MOCK_APPS } from "./mocks";

export const metadata: Metadata = { title: "Mock dashboards" };

/** Development index of the mock dashboards, grouped by the app they belong to. */
export default function MockDashboardsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
        <h1 className="text-lg font-semibold tracking-tight">Mock dashboards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hand-written dashboards with realistic static data, to see how real dashboards look with the dashboard kit.
          Development only.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MOCK_APPS.map(({ app, dashboards }) => (
            <section key={app} className="rounded-xl border p-4">
              <h2 className="text-sm font-medium">{app}</h2>
              <ul className="mt-2 space-y-0.5">
                {dashboards.map((dashboard) => (
                  <li key={dashboard.slug}>
                    <Link
                      href={`/kit/dashboards/${dashboard.slug}`}
                      className="-mx-2 block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {dashboard.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
