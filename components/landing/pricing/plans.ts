import { LINKS } from "../links";

/**
 * A plan on the pricing page. Prices are monthly, in USD; annual billing is
 * 20% off, shown per month. Enterprise has no list price: it's agreed with
 * sales, and nothing in the product knows about it yet.
 */
export type Plan = {
  id: "free" | "standard" | "team" | "enterprise";
  name: string;
  tagline: string;
  /** null: a custom price, agreed with sales. */
  monthly: number | null;
  annual: number | null;
  /** What the price is for: the whole plan, each editor, or whatever is agreed. */
  unit: "plan" | "editor" | "custom";
  /** The plan below this one, whose features this plan also has; the list then shows only what's added. */
  includes?: string;
  highlights: string[];
  cta: { label: string; href: string; external: boolean };
  featured?: boolean;
};

/* Paid plans are bought in the workspace's Billing section, after signing in. */
const billing = (label: string) => ({ label, href: LINKS.billing, external: false });

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it on your own data, no card needed.",
    monthly: 0,
    annual: 0,
    unit: "plan",
    highlights: ["1 editor", "3 data connections", "5 apps", "Limited AI usage", "All data sources", "Unlimited guests"],
    cta: { label: "Start for free", href: LINKS.app, external: false },
  },
  {
    id: "standard",
    name: "Standard",
    tagline: "For one person building dashboards for real work.",
    monthly: 24,
    annual: 19,
    unit: "plan",
    includes: "Free",
    highlights: ["10 data connections", "25 apps", "More AI usage"],
    cta: billing("Get Standard"),
  },
  {
    id: "team",
    name: "Team",
    tagline: "For teams and agencies building together.",
    monthly: 49,
    annual: 39,
    unit: "editor",
    includes: "Standard",
    highlights: [
      "Unlimited editors",
      "25 data connections",
      "100 apps",
      "More AI usage per editor",
      "Free viewers",
      "Shared connections",
      "Roles and general access",
    ],
    cta: billing("Get Team"),
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For organizations that need higher limits or their own deployment.",
    monthly: null,
    annual: null,
    unit: "custom",
    includes: "Team",
    highlights: ["Custom limits on everything", "Private deployment"],
    cta: { label: "Contact sales", href: LINKS.sales, external: true },
  },
];

/** A cell in the comparison table: a tick, a dash, or a short value. */
export type Cell = boolean | string;

export type ComparisonRow = {
  label: string;
  /** A short line under the label. */
  hint?: string;
  values: Record<Plan["id"], Cell>;
};

export const COMPARISON: { title: string; rows: ComparisonRow[] }[] = [
  {
    title: "Usage",
    rows: [
      {
        label: "Editors",
        hint: "People who chat, build apps or manage connections",
        values: { free: "1", standard: "1", team: "Unlimited", enterprise: "Unlimited" },
      },
      {
        label: "Data connections",
        hint: "Each database, property, site or MCP server",
        values: { free: "3", standard: "10", team: "25", enterprise: "Custom" },
      },
      {
        label: "Apps",
        hint: "Deleting an app frees its place",
        values: { free: "5", standard: "25", team: "100", enterprise: "Custom" },
      },
      {
        label: "AI usage",
        hint: "Chatting with the agent that builds and edits",
        values: { free: "Limited", standard: "More", team: "More than Standard", enterprise: "Custom" },
      },
      {
        label: "Data sources",
        hint: "Databases, warehouses, analytics tools and any MCP server",
        values: { free: "All", standard: "All", team: "All", enterprise: "All" },
      },
    ],
  },
  {
    title: "Sharing",
    rows: [
      {
        label: "Guests",
        hint: "Share an app with anyone by email, view only",
        values: { free: "Unlimited", standard: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
      },
      {
        label: "Viewers",
        hint: "Members who see the workspace's apps",
        values: { free: false, standard: false, team: "Unlimited", enterprise: "Unlimited" },
      },
    ],
  },
  {
    title: "Workspace",
    rows: [
      {
        label: "Shared connections",
        hint: "Connect once, and the whole workspace uses it",
        values: { free: false, standard: false, team: true, enterprise: true },
      },
      {
        label: "Roles and general access",
        hint: "Admins, editors and viewers; share an app with the whole workspace",
        values: { free: false, standard: false, team: true, enterprise: true },
      },
    ],
  },
  {
    title: "Deployment",
    rows: [
      {
        label: "Private deployment",
        hint: "Your own OpenDashboards, run apart from everyone else's",
        values: { free: false, standard: false, team: false, enterprise: true },
      },
    ],
  },
];
