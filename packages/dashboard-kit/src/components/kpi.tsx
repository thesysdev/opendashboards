"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import type { CSSProperties } from "react";
import { z } from "zod/v4";

import { formatSchema, formatValue } from "../format";
import { goodWhenSchema, numbersSchema, toneSchema } from "../schema";
import { DeltaBadge, Sparkline, toNumbers, useCompare } from "./shared";

/* ---------- Kpi: the stat tile ---------- */

const kpiSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]).nullable(),
  format: formatSchema.optional(),
  previous: z.number().nullable().optional(),
  goodWhen: goodWhenSchema.optional(),
  hint: z.string().optional(),
  trend: numbersSchema.optional(),
  trendPrevious: numbersSchema.optional(),
  tone: toneSchema.optional(),
});

export const Kpi = defineComponent({
  name: "Kpi",
  props: kpiSchema,
  description:
    "Stat tile, only inside Kpis. value is a number (with format, change vs previous and an optional sparkline: trend, 8–13 points; trendPrevious dashed) or a short text such as a top plan, status or version (no format or previous; tone colours a status dot). hint is a short subtitle such as \"Last 12 weeks\" or \"Highest-converting plan\".",
  component: function KpiView({ props }: ComponentRenderProps<z.infer<typeof kpiSchema>>) {
    const compare = useCompare();
    const trend = toNumbers(props.trend);
    const trendPrevious = toNumbers(props.trendPrevious);
    const text = typeof props.value === "string" ? props.value : null;
    return (
      <section className="pdk-card pdk-kpi" aria-label={props.label}>
        <div className="pdk-kpi-label">
          <span>{props.label}</span>
        </div>
        <div className="pdk-kpi-main">
          {text !== null ? (
            <div className="pdk-kpi-value pdk-kpi-text" title={text}>
              {props.tone ? <span className={`pdk-kpi-dot pdk-kpi-dot-${props.tone}`} aria-hidden /> : null}
              <span className="pdk-kpi-text-value">{text}</span>
            </div>
          ) : (
            <div className="pdk-kpi-value">{formatValue(props.value, props.format)}</div>
          )}
          {text === null && trend.length > 1 ? (
            <Sparkline
              values={trend}
              previous={trendPrevious.length ? trendPrevious : undefined}
              showPrevious={compare.enabled}
            />
          ) : null}
        </div>
        {text === null && typeof props.previous === "number" && typeof props.value === "number" ? (
          <div className="pdk-kpi-foot">
            <DeltaBadge current={props.value} previous={props.previous} format={props.format} goodWhen={props.goodWhen} />
            <span title={`${compare.label}: ${formatValue(props.previous, props.format)}`}>
              vs {formatValue(props.previous, props.format)}
            </span>
          </div>
        ) : null}
        {props.hint ? <div className="pdk-kpi-hint">{props.hint}</div> : null}
      </section>
    );
  },
});

/* ---------- Kpis: the strip of stat tiles ---------- */

/** Most tiles per row at each size, before the strip wraps. */
const MAX_PER_ROW = { wide: 6, medium: 3, narrow: 2 } as const;

/** The fewest rows that fit, then columns spread evenly across them: 5 → 3 + 2, never 4 + 1. */
function columns(count: number, max: number): number {
  if (count <= 0) return 1;
  const rows = Math.ceil(count / max);
  return Math.ceil(count / rows);
}

const kpisSchema = z.object({
  items: z.array(Kpi.ref),
});

export const Kpis = defineComponent({
  name: "Kpis",
  props: kpisSchema,
  description:
    "A strip of Kpi tiles that lays itself out: one row of up to 6 on wide screens, balanced rows on narrower ones. Tiles are equal width; just list them.",
  component: function KpisView({ props, renderNode }: ComponentRenderProps<z.infer<typeof kpisSchema>>) {
    const items = Array.isArray(props.items) ? props.items : [];
    const style = {
      "--pdk-kpis-wide": columns(items.length, MAX_PER_ROW.wide),
      "--pdk-kpis-medium": columns(items.length, MAX_PER_ROW.medium),
      "--pdk-kpis-narrow": columns(items.length, MAX_PER_ROW.narrow),
    } as CSSProperties;
    return (
      <div className="pdk-kpis" style={style} data-odd={items.length % 2 === 1 ? "" : undefined}>
        <div className="pdk-kpis-grid">{renderNode(items)}</div>
      </div>
    );
  },
});

/* ---------- Stat: a headline number inside a Card ---------- */

const statSchema = z.object({
  value: z.number().nullable(),
  format: formatSchema.optional(),
  previous: z.number().nullable().optional(),
  goodWhen: goodWhenSchema.optional(),
  label: z.string().optional(),
});

export const Stat = defineComponent({
  name: "Stat",
  props: statSchema,
  description:
    "Headline number at the top of a Card, with change vs previous.",
  component: function StatView({ props }: ComponentRenderProps<z.infer<typeof statSchema>>) {
    const compare = useCompare();
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="pdk-card-headline" style={{ margin: 0 }}>
            {formatValue(props.value, props.format)}
          </span>
          <DeltaBadge current={props.value} previous={props.previous} format={props.format} goodWhen={props.goodWhen} />
        </div>
        {props.label || typeof props.previous === "number" ? (
          <p className="pdk-card-subtitle">
            {props.label}
            {props.label && typeof props.previous === "number" ? " · " : ""}
            {typeof props.previous === "number"
              ? `${formatValue(props.previous, props.format)} ${compare.label.toLowerCase()}`
              : ""}
          </p>
        ) : null}
      </div>
    );
  },
});
