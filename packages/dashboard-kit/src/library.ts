import { createLibrary, tagSchemaId, type ComponentGroup } from "@openuidev/react-lang";

import { Bars, Donut, Intervals, Reference, Series, TimeSeries, Waterfall } from "./components/charts";
import { Cohorts, Column, Funnel, Goal, Heatmap, KeyValues, Leaderboard, SegmentedBar, Table } from "./components/data";
import { ChipFilter, CompareToggle, DateRangeFilter, FilterBar, MultiSelectFilter, PeriodPicker, SearchFilter, SelectFilter } from "./components/filters";
import { Kpi, Kpis, Stat } from "./components/kpi";
import { GeoMap } from "./components/geo";
import { Flow, Scatter } from "./components/relations";
import { Card, Dashboard, DashboardHeader, Row, Section } from "./components/layout";
import { FORMAT_PRESETS, formatSchema } from "./format";
import { goodWhenSchema, WIDTHS, widthSchema } from "./schema";

// Name the shared types so each signature prints "Format" instead of the whole
// union (it appears ~20 times); the Layout notes define them once.
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
  Kpis,
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
      `Shared argument types: Format = ${FORMAT_PRESETS.map((preset) => `"${preset}"`).join(" | ")}, or {type, currency?, decimals?, prefix?, suffix?} to override, e.g. {type: "number", suffix: " seats"}. Width = ${WIDTHS.map((width) => `"${width}"`).join(" | ")}. GoodWhen = "up" | "down" | "neutral": which direction of change is good news.`,
      "Numbers are raw with a Format; never formatted strings like \"$1.2K\" or \"12%\". percent values are already percentages (18.4 = 18.4%); ratio is for fractions; duration is seconds, ms milliseconds, days days. A Kpi's text value is for words (a plan, a status, a version), never a number.",
      "Live data tools return { columns, rows, truncated }, rows being objects keyed by column. Read one column across all rows with a pluck: r = Query(...) then TimeSeries(r.rows.day, [Series(\"Events\", r.rows.events)]). Ask a query for exactly the rows and columns a card shows.",
      "To skip an optional argument before one you need, pass null: Kpi(\"Signups\", 2227, \"number\", null, null, \"Last 30 days\").",
      "Story order: a lead Section with one Kpis strip of 3–6 headline numbers, then trends, then breakdowns, then detail tables. Don't size Kpis: the strip lays them out. A number that needs a chart beside it is a Card with a Stat.",
      "Rows hold Cards only; their widths add up to a full row.",
    ],
  },
  {
    name: "Filters",
    components: ["FilterBar", "PeriodPicker", "DateRangeFilter", "ChipFilter", "SelectFilter", "MultiSelectFilter", "SearchFilter", "CompareToggle"],
    notes: [
      "One FilterBar right after the header, for dashboard-wide filters only: date filter first, then segments several cards read (plan, region), SearchFilter, and CompareToggle last.",
      "A switch that changes only one card, such as what it's broken down by (channel or referring domain; device, browser or OS) or which metric it plots, belongs in that Card's controls, not the FilterBar. Its $variable feeds only that card's Query or data.",
      "A filter must change what is shown, but only cards whose numbers depend on it read it; point-in-time or cross-segment cards can ignore it. Declare $period = \"30d\" and pass $period to the filter. With live data, pass the $variable into the data tool's arguments so the Query reloads when it changes. With data written into the program, key values by option: data[$period].mrr (nest keys for two filters: data[$period][$channel].signups).",
    ],
  },
  {
    name: "Metrics",
    components: ["Kpis", "Kpi", "Stat", "KeyValues", "Goal"],
    notes: [
      "Give previous-period values wherever they exist (Kpi, Stat, Series, Funnel, Leaderboard, GeoMap) and add a CompareToggle.",
      "Set goodWhen \"down\" for metrics where lower is better: costs, CAC, churn, latency, errors.",
    ],
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
