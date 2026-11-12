import type { Metadata } from "next";
import Link from "next/link";

import { LandingPrompt } from "@/components/landing/landing-prompt";
import { Brand } from "@/components/shell/brand";
import { Footer } from "@/components/shell/footer";
import { NavLink } from "@/components/shell/nav-link";
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
 * What a signed-out visitor sees: the app's shell and the home page's
 * composer, with nothing of a user's in it. Sign-in comes when they send a
 * prompt or follow a link. proxy.ts sends signed-in visitors on to /apps.
 *
 * The shell is a copy of app/(app)/layout.tsx's, which needs a user; keep the
 * two looking the same.
 */
export default function LandingPage() {
  const examples = config().demoData.datasets.flatMap((dataset) => dataset.prompts);
  return (
    <div className="flex h-dvh bg-neutral-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <aside className="hidden w-60 shrink-0 flex-col px-2 py-3 md:flex">
        <div className="mb-3 flex h-9 shrink-0 items-center px-2">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
          <NavLink href="/" label="New App" icon="new" exact />
          <div className="mt-2 min-h-0 flex-1">
            <p className="py-1.5 pl-7 text-xs text-muted-foreground">No apps yet</p>
          </div>
          <div className="shrink-0 border-t pt-2">
            <NavLink href="/connections" label="Data Connections" icon="connections" prefetch={false} />
          </div>
        </nav>
        <div className="mt-1 shrink-0 px-2 py-1.5">
          <SignIn className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 md:hidden">
          <Brand />
          <SignIn />
        </header>

        <main className="mx-2 min-h-0 flex-1 overflow-y-auto rounded-xl border bg-background md:mt-2 md:ml-0">
          <div className="relative min-h-full">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(0.95_0.03_265)_0%,transparent_70%)]"
            />
            <div className="relative mx-auto w-full max-w-3xl px-6 pt-20 pb-16 sm:pt-28">
              <h1 className="text-center text-3xl font-bold tracking-tight sm:text-[2.5rem] sm:leading-tight">
                What do you want to build?
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-center text-[0.9375rem] text-pretty text-muted-foreground">
                Describe a dashboard. OpenDashboards builds it live from your PostHog, Postgres, MySQL, ClickHouse,
                BigQuery, Google Analytics or Search Console data, and you refine it by chatting.
              </p>
              <div className="mt-10">
                <LandingPrompt examples={examples} />
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}

/** /apps is behind the gateway's sign-in: nothing to prefetch, and nothing for crawlers. */
function SignIn({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" className={className}>
      <Link href="/apps" prefetch={false} rel="nofollow">
        Sign in
      </Link>
    </Button>
  );
}
