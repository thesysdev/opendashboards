"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { z } from "zod/v4";

import { widthClass, widthSchema, type Width } from "../schema";
import { Bars, Donut, Intervals, TimeSeries, Waterfall } from "./charts";
import { Cohorts, Funnel, Goal, Heatmap, KeyValues, Leaderboard, SegmentedBar, Table } from "./data";
import { ChipFilter, FilterBar, SelectFilter } from "./filters";
import { Kpis, Stat } from "./kpi";
import { GeoMap } from "./geo";
import { Flow, Scatter } from "./relations";
import { CompareProvider } from "./shared";

/* ---------- Card ---------- */

const cardContent = z.union([
  Stat.ref,
  TimeSeries.ref,
  Bars.ref,
  Donut.ref,
  Waterfall.ref,
  Intervals.ref,
  Flow.ref,
  Scatter.ref,
  GeoMap.ref,
  Funnel.ref,
  Cohorts.ref,
  Heatmap.ref,
  Table.ref,
  Leaderboard.ref,
  Goal.ref,
  SegmentedBar.ref,
  KeyValues.ref,
]);

const cardSchema = z.object({
  title: z.string(),
  content: z.array(cardContent),
  width: widthSchema.optional(),
  subtitle: z.string().optional(),
  controls: z.array(z.union([ChipFilter.ref, SelectFilter.ref])).optional(),
});

export const Card = defineComponent({
  name: "Card",
  props: cardSchema,
  description:
    "content stacks top to bottom, usually [Stat?, one visual]. Default width \"half\". title says what is plotted; subtitle gives units, period or source (\"Weekly · USD\"). controls are this card's own switches, shown in its header: a ChipFilter or SelectFilter for what the card is broken down by or which metric it plots, e.g. Card(\"Top sources\", [Leaderboard(...)], \"half\", \"Visitors\", [ChipFilter(\"sourceBy\", [{value: \"channel\", label: \"Channel\"}, {value: \"domain\", label: \"Domain\"}], $sourceBy)]).",
  component: ({ props, renderNode }: ComponentRenderProps<z.infer<typeof cardSchema>>) => (
    <section className={`pdk-card ${widthClass(props.width, "half")}`} aria-label={props.title}>
      <header className="pdk-card-head">
        <div>
          <h3 className="pdk-card-title">{props.title}</h3>
          {props.subtitle ? <p className="pdk-card-subtitle">{props.subtitle}</p> : null}
        </div>
        {Array.isArray(props.controls) && props.controls.length ? (
          <div className="pdk-card-controls" role="toolbar" aria-label={`${props.title} view`}>
            {renderNode(props.controls)}
          </div>
        ) : null}
      </header>
      <div className="pdk-card-body">{renderNode(props.content)}</div>
    </section>
  ),
});

/* ---------- Row ---------- */

const rowSchema = z.object({
  items: z.array(Card.ref),
});

export const Row = defineComponent({
  name: "Row",
  props: rowSchema,
  description:
    "Cards side by side on a 12-column grid; their widths add up to a full row.",
  component: function RowView({ props, renderNode }: ComponentRenderProps<z.infer<typeof rowSchema>>) {
    const items = Array.isArray(props.items) ? props.items : [];
    const widths = items.map((item) => {
      const node = item as { typeName?: string; props?: { width?: Width | null } } | null;
      return node?.props?.width ?? "half";
    });
    const mediumFill = orphans(widths, ["quarter", "third", "half"]);
    const smallFill = orphans(widths, ["quarter"]);
    return (
      <div className="pdk-row">
        {items.map((item, i) => (
          <div key={i} className={`pdk-cell ${widthClass(widths[i], "half")}${mediumFill.has(i) ? " pdk-md-full" : ""}${smallFill.has(i) ? " pdk-sm-full" : ""}`}>
            {renderNode(item)}
          </div>
        ))}
      </div>
    );
  },
});

/**
 * At narrower sizes some widths become halves and the rest full lines
 * (below 1100px: quarter, third and half; below 720px: quarter only). Find the
 * halves that would then sit alone beside an empty half, so they can take the
 * whole line instead.
 */
function orphans(widths: Width[], halves: Width[]): Set<number> {
  const fill = new Set<number>();
  let open: number | null = null; // a half waiting for a partner
  widths.forEach((width, i) => {
    if (!halves.includes(width)) {
      if (open !== null) fill.add(open);
      open = null;
    } else if (open === null) {
      open = i;
    } else {
      open = null;
    }
  });
  if (open !== null) fill.add(open);
  return fill;
}

/* ---------- Section ---------- */

const sectionSchema = z.object({
  title: z.string(),
  rows: z.array(z.union([Kpis.ref, Row.ref])),
  description: z.string().optional(),
});

export const Section = defineComponent({
  name: "Section",
  props: sectionSchema,
  description:
    "A titled group of Kpis strips and Rows of Cards. Pass \"\" as title for the lead KPI section.",
  component: ({ props, renderNode }: ComponentRenderProps<z.infer<typeof sectionSchema>>) => (
    <section className="pdk-section">
      {props.title ? (
        <div className="pdk-section-head">
          <h2 className="pdk-section-title">{props.title}</h2>
          {props.description ? <p className="pdk-section-description">{props.description}</p> : null}
        </div>
      ) : null}
      {renderNode(props.rows)}
    </section>
  ),
});

/* ---------- Dashboard (root) ---------- */

const dashboardSchema = z.object({
  children: z.array(z.union([FilterBar.ref, Section.ref])),
});

export const Dashboard = defineComponent({
  name: "Dashboard",
  props: dashboardSchema,
  description: "The root.",
  component: ({ props, renderNode }: ComponentRenderProps<z.infer<typeof dashboardSchema>>) => (
    <CompareProvider>
      <div className="pdk-root pdk-container">
        <div className="pdk-dashboard">{renderNode(props.children)}</div>
      </div>
    </CompareProvider>
  ),
});
