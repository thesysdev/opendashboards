import { createLibrary, tagSchemaId, type ComponentGroup, type PromptOptions } from "@openuidev/react-lang";

import { Bars, Donut, Intervals, Reference, Series, TimeSeries, Waterfall } from "./components/charts";
import { Cohorts, Column, Funnel, Goal, Heatmap, KeyValues, Leaderboard, SegmentedBar, Table } from "./components/data";
import { ChipFilter, CompareToggle, DateRangeFilter, FilterBar, MultiSelectFilter, PeriodPicker, SearchFilter, SelectFilter } from "./components/filters";
import { Kpi, Stat } from "./components/kpi";
import { GeoMap } from "./components/geo";
import { Flow, Scatter } from "./components/relations";
import { Card, Dashboard, DashboardHeader, Row, Section } from "./components/layout";
import { FORMAT_PRESETS, formatSchema } from "./format";
import { goodWhenSchema, WIDTHS, widthSchema } from "./schema";

// Name the shared types so each signature prints "Format" instead of the whole
// union (it appears ~20 times); the preamble defines them once.
tagSchemaId(formatSchema, "Format");
tagSchemaId(widthSchema, "Width");
tagSchemaId(goodWhenSchema, "GoodWhen");

export const components = [
  Dashboard,
  DashboardHeader,
  FilterBar,
  PeriodPicker,
  DateRangeFilter,
  MultiSelectFilter,
  SearchFilter,
  ChipFilter,
  SelectFilter,
  CompareToggle,
  Section,
  Row,
  Kpi,
  Card,
  Stat,
  TimeSeries,
  Series,
  Reference,
  Bars,
  Donut,
  SegmentedBar,
  Waterfall,
  Intervals,
  Flow,
  Scatter,
  GeoMap,
  Funnel,
  Cohorts,
  Heatmap,
  Table,
  Column,
  Leaderboard,
  Goal,
  KeyValues,
];

export const componentGroups: ComponentGroup[] = [
  {
    name: "Layout",
    components: ["Dashboard", "DashboardHeader", "Section", "Row", "Card"],
    notes: [
      "Story order: a lead Section of 4 quarter-width Kpis (or 3 thirds), then trends, then breakdowns, then detail tables.",
      "Widths in each Row add up to a full row.",
    ],
  },
  {
    name: "Filters",
    components: ["FilterBar", "PeriodPicker", "DateRangeFilter", "ChipFilter", "SelectFilter", "MultiSelectFilter", "SearchFilter", "CompareToggle"],
    notes: [
      "One FilterBar right after the header: date filter first, then segment filters, SearchFilter, and CompareToggle last. Never put filters inside cards.",
      "A filter must change what is shown: declare $period = \"30d\", pass $period to the filter, and read affected values from one object keyed by option: data[$period].mrr. With two filters nest the keys: data[$period][$channel].signups.",
    ],
  },
  {
    name: "Metrics",
    components: ["Kpi", "Stat", "KeyValues", "Goal"],
  },
  {
    name: "Charts",
    components: ["TimeSeries", "Series", "Reference", "Bars", "Donut", "SegmentedBar", "Waterfall", "Intervals", "Flow", "Scatter", "GeoMap"],
    notes: [
      "Choose by question: over time → TimeSeries; across categories → Bars; part of a whole → SegmentedBar (Donut for ≤3 parts); how a total moved → Waterfall; uncertainty → Intervals; paths between stages → Flow; two measures per item → Scatter; by country or US state → GeoMap.",
      "One unit per chart (no dual axes); split different units into separate charts.",
    ],
  },
  {
    name: "Analysis",
    components: ["Funnel", "Cohorts", "Heatmap", "Table", "Column", "Leaderboard"],
    notes: [
      "Funnel for ordered steps, Cohorts for retention, Heatmap for two categorical axes, Leaderboard for top-N, Table for several measures per row.",
      "Start a Funnel at the first meaningful step (signup started), not raw traffic; show traffic as a Kpi.",
    ],
  },
];

export const library = createLibrary({
  root: "Dashboard",
  components,
  componentGroups,
});

const EXAMPLE = `root = Dashboard([header, filters, kpis, trends, breakdown])
$period = "30d"
header = DashboardHeader("Growth overview", "Signups, activation and revenue for the self-serve funnel.", ["PostHog", "Stripe", "Updated 5 min ago"])
filters = FilterBar([PeriodPicker("period", [{value: "30d", label: "30D"}, {value: "90d", label: "90D"}], $period), CompareToggle("Previous period")])
data = {"30d": {signups: 4612, signupsPrev: 4238, trend: [148, 152, 160, 149, 171, 166, 158], trendPrev: [139, 141, 150, 146, 152, 149, 151], mrr: 412600, mrrPrev: 398200}, "90d": {signups: 13120, signupsPrev: 12020, trend: [410, 432, 455, 470, 492, 501, 516], trendPrev: [380, 391, 402, 417, 420, 433, 440], mrr: 412600, mrrPrev: 362900}}
kpis = Section("", [kpiRow])
kpiRow = Row([Kpi("Signups", data[$period].signups, "number", data[$period].signupsPrev, data[$period].trend, "up", "quarter", data[$period].trendPrev), Kpi("MRR", data[$period].mrr, "currency-compact", data[$period].mrrPrev), Kpi("Trial → paid", 18.4, "percent", 17.1), Kpi("Paid CAC", 1060, "currency", 1140, null, "down")])
trends = Section("Trends", [trendRow])
trendRow = Row([signupCard, channelCard])
signupCard = Card("Signups per week", [Stat(1184, "number", 1092, "up", "Last week"), TimeSeries(weeks, [Series("Signups", [912, 948, 1003, 987, 1050, 1092, 1184], [850, 871, 902, 925, 940, 961, 998])], "area")], "two-thirds", "Self-serve, all channels")
weeks = ["Sep 21", "Sep 28", "Oct 5", "Oct 12", "Oct 19", "Oct 26", "Nov 2"]
channelCard = Card("Signups by channel", [Leaderboard(["Organic search", "Paid social", "Direct", "Referral"], [1840, 1210, 980, 582], "number", [1702, 1260, 901, 375])], "third", "Last 30 days")
breakdown = Section("Conversion", [funnelRow])
funnelRow = Row([Card("Signup funnel", [Funnel(["Signed up", "Verified email", "Created workspace", "Activated", "Paid"], [4612, 3920, 2890, 2010, 370], [4238, 3561, 2512, 1792, 322])], "full")])`;

export const promptOptions: PromptOptions = {
  preamble: [
    "You build polished analytics dashboards for growth, product, marketing and sales teams. Lead with the few numbers that matter, show how they move over time against the previous period, then explain them with breakdowns.",
    "",
    "Shared types used in the signatures below:",
    `- Format = ${FORMAT_PRESETS.map((preset) => `"${preset}"`).join(" | ")}, or {type: <one of those>, currency?: string, decimals?: number, prefix?: string, suffix?: string} for overrides such as {type: "number", suffix: " seats"}.`,
    `- Width = ${WIDTHS.map((width) => `"${width}"`).join(" | ")}.`,
    '- GoodWhen = "up" | "down" | "neutral": which direction of change is good news (colours the deltas).',
  ].join("\n"),
  examples: [EXAMPLE],
  additionalRules: [
    "Values are raw numbers with a Format; never formatted strings like \"$1.2K\" or \"12%\". percent values are already percentages (18.4 = 18.4%); ratio is for fractions. duration is seconds, ms is milliseconds, days is days.",
    "Give previous-period values wherever they exist (Kpi, Stat, Series, Funnel, Leaderboard, GeoMap) and add a CompareToggle.",
    "Set goodWhen \"down\" for metrics where lower is better: costs, CAC, churn, latency, errors.",
  ],
};
