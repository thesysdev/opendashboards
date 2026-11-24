import type { Metadata } from "next";

import { Faq, type FaqItem } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Comparison } from "@/components/landing/pricing/comparison";
import { PlanCards } from "@/components/landing/pricing/plan-cards";

import { alt as OG_ALT } from "../../opengraph-image";

const TITLE = "Pricing";
const DESCRIPTION =
  "Start free. Pay per editor as you grow: Standard $19 and Team $39 a month, billed annually. Enterprise on request. Guests are free on every plan.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  // Set in full: a page's openGraph replaces the root layout's, and with it the generated image.
  openGraph: {
    type: "website",
    siteName: "OpenDashboards",
    title: `${TITLE} · OpenDashboards`,
    description: DESCRIPTION,
    url: "/pricing",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: { card: "summary_large_image", title: `${TITLE} · OpenDashboards`, description: DESCRIPTION, images: ["/opengraph-image"] },
};

const PRICING_FAQS: FaqItem[] = [
  {
    question: "Who counts as an editor?",
    answer: [
      "Anyone who chats with the agent, builds or edits an app, or adds and manages data connections.",
      "People who only look at dashboards are never editors, and never cost anything.",
    ],
  },
  {
    question: "Do guests and viewers cost anything?",
    answer: [
      "No. Guests are people you share an app with by email, like a client or your boss. They can view it but not edit it, and they're free and unlimited on every plan.",
      "Viewers are members who can see the workspace's apps without being shared each one. They come with Team and Enterprise, also free.",
    ],
  },
  {
    question: "What counts as a data connection?",
    answer: [
      "Each source you connect: a database, a Google Analytics property, a Search Console site, a PostHog project or an MCP server.",
      "An agency connecting three clients' Google Analytics properties uses three connections.",
    ],
  },
  {
    question: "What counts as AI usage?",
    answer: [
      "Chatting with the agent that builds and edits your dashboards. Each plan includes more than the one before it.",
      "Opening a dashboard, changing a filter or picking a month doesn't use any.",
    ],
  },
  {
    question: "What happens when I reach a limit?",
    answer: [
      "You'll be asked to move to a bigger plan before you add more. Your existing dashboards keep working, and so does everything you've shared.",
      "Deleting an app you no longer need frees its place, so experimenting never uses up your plan.",
    ],
  },
  {
    question: "Is self-hosting free?",
    answer: [
      "Yes. OpenDashboards is open source. These plans are for the hosted version at opendashboards.com.",
    ],
  },
  {
    question: "What happens to an editor I remove?",
    answer: ["Their seat is free for someone else. To pay for fewer seats, email support@thesys.dev."],
  },
  {
    question: "What if I move to a smaller plan or cancel?",
    answer: [
      "Nothing is deleted, and everything you've shared keeps working. If you're over the new plan's limits, your workspace becomes view-only until you delete enough apps or connections to fit, or upgrade.",
      "If you cancel, your workspace moves to Free at the end of the period you've paid for.",
    ],
  },
  {
    question: "Do you offer refunds?",
    answer: [
      "Refunds are at our discretion. You can cancel at any time, and you won't be charged for the next billing cycle.",
    ],
  },
];

/** The pricing page: the plans, a feature-by-feature comparison, then questions about billing. */
export default function PricingPage() {
  return (
    <>
      <Header />
      <main>
        <section
          aria-labelledby="pricing-title"
          className="mx-auto w-full max-w-[calc(75rem+2*var(--gutter))] px-(--gutter) pt-[clamp(3.5rem,7vw,6rem)] text-neutral-950 [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
        >
          <header className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center">
            <h1
              id="pricing-title"
              className="font-(family-name:--font-display) text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance"
            >
              Pay for the people who build
            </h1>
            <p className="mt-4 max-w-2xl text-[clamp(1rem,1.4vw,1.1875rem)] leading-normal text-pretty text-neutral-950/60">
              Start free, and pay per editor as you grow. People who only view your dashboards are always free.
            </p>
          </header>
          <PlanCards />
        </section>
        <Comparison />
        <Faq items={PRICING_FAQS} />
      </main>
      <Footer />
    </>
  );
}
