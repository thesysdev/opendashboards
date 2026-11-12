import {
  siAirtable,
  siClickhouse,
  siDatabricks,
  siDatadog,
  siGithub,
  siGooglebigquery,
  siGoogleanalytics,
  siGooglesheets,
  siHotjar,
  siHubspot,
  siJira,
  siLemonsqueezy,
  siLinear,
  siMatomo,
  siMixpanel,
  siModelcontextprotocol,
  siMongodb,
  siMysql,
  siNotion,
  siPaddle,
  siPaypal,
  siPlausibleanalytics,
  siPostgresql,
  siPosthog,
  siQuickbooks,
  siSentry,
  siShopify,
  siSnowflake,
  siStripe,
  siSupabase,
  siZendesk,
} from "simple-icons";

import { SectionHeader } from "../section-header";
import { LogoBubbles, type Logo } from "./logo-bubbles";

/** Each group's marks, in saturated colours that hold on the white badge. */
const GROUPS: { title: string; description: string; logos: Logo[] }[] = [
  {
    title: "Product analytics",
    description: "Traffic, signups, funnels, feature usage and retention.",
    logos: [
      { icon: siPosthog, name: "PostHog", color: "#1d4aff" },
      { icon: siGoogleanalytics, name: "Google Analytics", color: "#e37400" },
      { icon: siMixpanel, name: "Mixpanel", color: "#7856ff" },
      { icon: siHotjar, name: "Hotjar", color: "#ff3c00" },
      { icon: siPlausibleanalytics, name: "Plausible", color: "#5850ec" },
      { icon: siMatomo, name: "Matomo", color: "#2f6be0" },
      { icon: siDatadog, name: "Datadog", color: "#7b3fe4" },
      { icon: siSentry, name: "Sentry", color: "#6c5fc7" },
    ],
  },
  {
    title: "Databases",
    description: "Customers, orders, accounts and anything in your tables.",
    logos: [
      { icon: siPostgresql, name: "PostgreSQL", color: "#336df5" },
      { icon: siMysql, name: "MySQL", color: "#1f8fd8" },
      { icon: siGooglebigquery, name: "BigQuery", color: "#2f7af5" },
      { icon: siSnowflake, name: "Snowflake", color: "#12a7e0" },
      { icon: siMongodb, name: "MongoDB", color: "#13aa52" },
      { icon: siSupabase, name: "Supabase", color: "#1fb978" },
      { icon: siClickhouse, name: "ClickHouse", color: "#d99a00" },
      { icon: siDatabricks, name: "Databricks", color: "#ff3621" },
    ],
  },
  {
    title: "Revenue and CRM",
    description: "MRR, subscriptions, invoices, deals and pipeline.",
    logos: [
      { icon: siStripe, name: "Stripe", color: "#635bff" },
      { icon: siPaypal, name: "PayPal", color: "#0070e0" },
      { icon: siShopify, name: "Shopify", color: "#5a9e2f" },
      { icon: siPaddle, name: "Paddle", color: "#d4a000" },
      { icon: siLemonsqueezy, name: "Lemon Squeezy", color: "#e69500" },
      { icon: siQuickbooks, name: "QuickBooks", color: "#2ca01c" },
      { icon: siHubspot, name: "HubSpot", color: "#ff5c35" },
    ],
  },
  {
    title: "Anything else",
    description: "Issues, tickets, docs and sheets, through any MCP server.",
    logos: [
      { icon: siModelcontextprotocol, name: "MCP", color: "#111111" },
      { icon: siGithub, name: "GitHub", color: "#181717" },
      { icon: siLinear, name: "Linear", color: "#5e6ad2" },
      { icon: siNotion, name: "Notion", color: "#111111" },
      { icon: siJira, name: "Jira", color: "#2684ff" },
      { icon: siGooglesheets, name: "Google Sheets", color: "#0f9d58" },
      { icon: siAirtable, name: "Airtable", color: "#0aa8ff" },
      { icon: siZendesk, name: "Zendesk", color: "#0a8f8f" },
    ],
  },
];

/**
 * "Connect the tools you already use": four groups of tools in one panel,
 * split by hairlines (two by two below 1024px), each led by its logos. Phones
 * get a swipeable row of separate cards, the next one peeking in.
 */
export function Connectors() {
  return (
    <section
      id="connectors"
      aria-labelledby="connectors-title"
      className="flex w-full flex-col gap-[clamp(2.25rem,4.5vw,3.25rem)] pt-[clamp(7rem,13.4vw,12rem)] text-neutral-950"
    >
      <SectionHeader
        id="connectors-title"
        title="Connect the tools you already use."
        subtitle="Your data stays where it is. OpenDashboards reads across all of them."
      />

      <div className="mx-auto box-border w-full max-w-[calc(75rem+2*var(--fold-gutter))] px-(--fold-gutter) [--fold-gutter:clamp(1.25rem,3vw,2.5rem)]">
        <ul className="grid grid-cols-2 overflow-hidden rounded-[20px] border border-black/6 bg-white max-md:-mx-(--fold-gutter) max-md:flex max-md:snap-x max-md:snap-mandatory max-md:scroll-px-4 max-md:gap-3 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:pt-1 max-md:pb-2 lg:grid-cols-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {GROUPS.map((group, index) => (
            <li
              key={group.title}
              className="flex flex-col border-black/6 px-7 pt-[clamp(2rem,4vw,3.25rem)] pb-[clamp(2rem,4vw,3rem)] text-pretty max-md:flex-[0_0_82%] max-md:snap-start max-md:rounded-[20px] max-md:border max-md:bg-white max-md:px-5 max-md:py-7 md:max-lg:even:border-l md:max-lg:nth-[n+3]:border-t lg:not-first:border-l"
            >
              {/* Logos lead each column as its picture. */}
              <LogoBubbles logos={group.logos} stagger={index} />
              <h3 className="mb-1.5 text-center font-(family-name:--font-display) text-lg leading-normal font-semibold tracking-[-0.01em]">
                {group.title}
              </h3>
              <p className="text-center text-[15px] leading-normal text-neutral-950/60">{group.description}</p>
              {/* The names stay for screen readers; the logos carry them visually. */}
              <p className="sr-only">{group.logos.map((logo) => logo.name).join(", ")}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
