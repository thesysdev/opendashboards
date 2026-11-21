import { LINKS } from "../links";

/** Monthly prices in USD. Annual billing is 20% off, shown per month. */
export type Plan = {
  id: "free" | "standard" | "team" | "business";
  name: string;
  tagline: string;
  monthly: number;
  annual: number;
  /** What the price is for: the whole plan, or each editor. */
  unit: "plan" | "editor";
  /** The plan below this one, whose features this plan also has; the list then shows only what's added. */
  includes?: string;
  highlights: string[];
  cta: { label: string; href: string; external: boolean };
  featured?: boolean;
};

/* Paid plans aren't self-serve yet, so they go to a call with the team. */
const TALK_TO_US = { label: "Talk to us", href: LINKS.sales, external: true };

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
    cta: TALK_TO_US,
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
      "Roles and team access",
    ],
    cta: TALK_TO_US,
    featured: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "For heavy use, with no limits on what you connect or build.",
    monthly: 99,
    annual: 79,
    unit: "editor",
    includes: "Team",
    highlights: ["Unlimited data connections", "Unlimited apps", "Highest AI usage"],
    cta: TALK_TO_US,
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
        values: { free: "1", standard: "1", team: "Unlimited", business: "Unlimited" },
      },
      {
        label: "Data connections",
        hint: "Each database, property, site or MCP server",
        values: { free: "3", standard: "10", team: "25", business: "Unlimited" },
      },
      {
        label: "Apps",
        hint: "Deleting an app frees its place",
        values: { free: "5", standard: "25", team: "100", business: "Unlimited" },
      },
      {
        label: "AI usage",
        hint: "Chatting with the agent that builds and edits",
        values: { free: "Limited", standard: "More", team: "More than Standard", business: "Highest" },
      },
      {
        label: "Data sources",
        hint: "Databases, warehouses, analytics tools and any MCP server",
        values: { free: "All", standard: "All", team: "All", business: "All" },
      },
    ],
  },
  {
    title: "Sharing",
    rows: [
      {
        label: "Guests",
        hint: "Share an app with anyone by email, view only",
        values: { free: "Unlimited", standard: "Unlimited", team: "Unlimited", business: "Unlimited" },
      },
      {
        label: "Viewers",
        hint: "Teammates who see the team's apps",
        values: { free: false, standard: false, team: "Unlimited", business: "Unlimited" },
      },
    ],
  },
  {
    title: "Teams",
    rows: [
      {
        label: "Shared connections",
        hint: "Connect once, and the whole team uses it",
        values: { free: false, standard: false, team: true, business: true },
      },
      {
        label: "Roles and team access",
        hint: "Admins, editors and viewers; share an app with the whole team",
        values: { free: false, standard: false, team: true, business: true },
      },
    ],
  },
];
