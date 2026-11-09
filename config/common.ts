import type { CommonSettings } from "./settings";

/** Settings that are the same locally and in production. */
export const common: CommonSettings = {
  openui: {
    apiUrl: "https://api.thesys.dev",
    gatewayUrl: "https://api.thesys.dev/v1/embed",
    model: "anthropic/claude-sonnet-5.5",
    maxAgentRounds: 24,
  },
  posthog: { queryTimeoutMs: 50_000, checkTimeoutMs: 15_000, maxRows: { agent: 200, dashboard: 10_000 } },
  kms: { region: "us-east-1" },
  postgres: { connectTimeoutMs: 5_000, statementTimeoutMs: 15_000, maxRows: { agent: 200, dashboard: 10_000 } },
  demoDatasets: [
    {
      key: "retail",
      name: "Retail sales",
      description:
        "A sample retail business: orders, order lines, products, customers, promotions, refunds and sales targets. " +
        "Raw tables are in the retail schema; the analytics schema has ready-made reporting views " +
        "(daily_sales_by_region, monthly_business_kpis, customer_summary, target_attainment, …). " +
        "Prefer the analytics views for standard metrics and use the retail tables for anything they don't cover.",
      postgres: {
        // Neon's pooler: Prism opens a connection per query.
        host: "ep-wispy-hill-bbojf1nh-pooler.c-15.us-east-1.aws.neon.tech",
        port: 5432,
        database: "retail_sales",
        user: "prism_demo_reader",
        sslMode: "verify-full",
      },
      prompts: [
        "An executive overview: revenue, orders, average order value and margin by month",
        "Sales by region and product category over the last 90 days",
        "How much promotions and refunds cost us each month",
      ],
    },
  ],
};
