"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { z } from "zod/v4";

import { formatSchema, formatValue } from "../format";
import { goodWhenSchema, numbersSchema, widthClass, widthSchema } from "../schema";
import { DeltaBadge, Sparkline, toNumbers, useCompare } from "./shared";

/* ---------- Kpi: the stat tile ---------- */

const kpiSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  format: formatSchema.optional(),
  previous: z.number().nullable().optional(),
  trend: numbersSchema.optional(),
  goodWhen: goodWhenSchema.optional(),
  width: widthSchema.optional(),
  trendPrevious: numbersSchema.optional(),
  hint: z.string().optional(),
});

export const Kpi = defineComponent({
  name: "Kpi",
  props: kpiSchema,
  description:
    "Stat tile with change vs previous and an optional sparkline (trend, 8–13 points; trendPrevious dashed). hint is a short subtitle such as \"Last 12 weeks\". Default width \"quarter\".",
  component: function KpiView({ props }: ComponentRenderProps<z.infer<typeof kpiSchema>>) {
    const compare = useCompare();
    const trend = toNumbers(props.trend);
    const trendPrevious = toNumbers(props.trendPrevious);
    return (
      <section className={`pdk-card pdk-kpi ${widthClass(props.width, "quarter")}`} aria-label={props.label}>
        <div className="pdk-kpi-label">
          <span>{props.label}</span>
          {props.hint ? <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--pdk-ink-muted)" }}>{props.hint}</span> : null}
        </div>
        <div className="pdk-kpi-main">
          <div className="pdk-kpi-value">{formatValue(props.value, props.format)}</div>
          {trend.length > 1 ? (
            <Sparkline
              values={trend}
              previous={trendPrevious.length ? trendPrevious : undefined}
              showPrevious={compare.enabled}
            />
          ) : null}
        </div>
        {typeof props.previous === "number" && typeof props.value === "number" ? (
          <div className="pdk-kpi-foot">
            <DeltaBadge current={props.value} previous={props.previous} format={props.format} goodWhen={props.goodWhen} />
            <span title={`${compare.label}: ${formatValue(props.previous, props.format)}`}>
              vs {formatValue(props.previous, props.format)}
            </span>
          </div>
        ) : null}
      </section>
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
