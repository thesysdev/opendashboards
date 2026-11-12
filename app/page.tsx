import type { Metadata } from "next";
import Link from "next/link";

import { LandingPrompt } from "@/components/landing/landing-prompt";
import { Brand } from "@/components/shell/brand";
import { Footer } from "@/components/shell/footer";
import { Button } from "@/components/ui/button";
import { config } from "@/config";
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

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OpenDashboards",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: "Thesys", url: "https://www.thesys.dev" },
};

/**
 * What a signed-out visitor sees: the home page's composer. Sign-in comes
 * when they send a prompt. proxy.ts sends signed-in visitors on to /apps.
 */
export default function LandingPage() {
  const examples = config().demoData.datasets.flatMap((dataset) => dataset.prompts);
  return (
    <div className="relative flex min-h-full flex-col bg-neutral-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(0.95_0.03_265)_0%,transparent_70%)]"
      />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Brand />
        {/* /apps is behind the gateway's sign-in: nothing to prefetch, and nothing for crawlers. */}
        <Button asChild variant="outline">
          <Link href="/apps" prefetch={false} rel="nofollow">
            Sign in
          </Link>
        </Button>
      </header>

      <main className="relative mx-auto w-full max-w-3xl flex-1 px-6 pt-16 pb-16 sm:pt-24">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-[2.5rem] sm:leading-tight">
          What do you want to build?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-[0.9375rem] text-pretty text-muted-foreground">
          Describe a dashboard. OpenDashboards builds it live from your PostHog, Postgres, MySQL, ClickHouse, BigQuery,
          Google Analytics or Search Console data, and you refine it by chatting.
        </p>
        <div className="mt-10">
          <LandingPrompt examples={examples} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
