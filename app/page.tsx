import { DatabaseIcon, LayoutDashboardIcon, MessageSquareTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/shell/brand";
import { Footer } from "@/components/shell/footer";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/site";

const TITLE = "OpenDashboards: live dashboards from your data, built by chatting";
const DESCRIPTION =
  "Connect PostHog, Postgres, MySQL, ClickHouse, BigQuery, Google Analytics or Search Console, describe what you want to see, and refine the dashboard by chatting. Free to use.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
};

const STEPS = [
  {
    icon: DatabaseIcon,
    title: "Connect your data",
    body: "PostHog, Postgres, MySQL, ClickHouse, BigQuery, Google Analytics 4 or Search Console. Keys are encrypted at rest, and queries are read-only.",
  },
  {
    icon: MessageSquareTextIcon,
    title: "Describe what you want to see",
    body: "Ask for an executive overview, sales by region or how promotions and refunds cost you each month. OpenDashboards writes the queries and lays out the charts.",
  },
  {
    icon: LayoutDashboardIcon,
    title: "Refine by chatting",
    body: "Change a metric, add a breakdown or swap a chart in plain language. Every dashboard stays live on your data.",
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OpenDashboards",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: "Thesys", url: "https://www.openui.com" },
};

/** The public landing page. proxy.ts sends signed-in visitors on to /apps. */
export default function LandingPage() {
  return (
    <div className="relative flex min-h-full flex-col bg-neutral-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(0.95_0.03_265)_0%,transparent_70%)]"
      />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" aria-label="OpenDashboards home" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Brand />
        </Link>
        <Button asChild variant="outline">
          <Link href="/apps">Sign in</Link>
        </Button>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
        <section className="flex flex-col items-center pt-16 pb-14 text-center md:pt-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            Live dashboards from your data, built by chatting.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            Connect PostHog, Postgres, BigQuery or Google Analytics and describe what you want to see. OpenDashboards
            builds the dashboard, and you refine it by chatting. Free to use.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/apps">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="https://www.openui.com/dashboards" target="_blank" rel="noopener">
                How it works
              </a>
            </Button>
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="pb-20">
          <h2 id="how-it-works" className="sr-only">
            How OpenDashboards works
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rounded-xl border bg-background p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
    </div>
  );
}
