import { createLibrary, tagSchemaId, type ComponentGroup } from "@openuidev/react-lang";

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
      "Values are raw numbers with a Format; never formatted strings like \"$1.2K\" or \"12%\". percent values are already percentages (18.4 = 18.4%); ratio is for fractions; duration is seconds, ms milliseconds, days days.",
      "To skip an optional argument before one you need, pass null: Kpi(\"CAC\", 1060, \"currency\", 1140, null, \"down\").",
      "Story order: a lead Section of 4 quarter-width Kpis (or 3 thirds), then trends, then breakdowns, then detail tables.",
      "Widths in each Row add up to a full row.",
    ],
  },
  {
    name: "Filters",
    components: ["FilterBar", "PeriodPicker", "DateRangeFilter", "ChipFilter", "SelectFilter", "MultiSelectFilter", "SearchFilter", "CompareToggle"],
    notes: [
      "One FilterBar right after the header: date filter first, then segment filters, SearchFilter, and CompareToggle last. Never put filters inside cards.",
      "Only cards whose numbers depend on a filter read it; point-in-time or cross-segment cards (open pipeline, a channel comparison) can ignore it. A filter must change what is shown: declare $period = \"30d\", pass $period to the filter, and read affected values from one object keyed by option: data[$period].mrr. With two filters nest the keys: data[$period][$channel].signups.",
    ],
  },
  {
    name: "Metrics",
    components: ["Kpi", "Stat", "KeyValues", "Goal"],
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
