"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod/v4";

import { formatSchema, formatValue, isDurationFormat, isRateFormat, isRatioFormat, type ValueFormat } from "../format";
import { goodWhenSchema, numbersSchema } from "../schema";
import { MUTED_COLOR, seriesColor } from "../theme";
import {
  Empty,
  Legend,
  nodeList,
  toNumbers,
  toStrings,
  TooltipCard,
  useCompare,
  type GoodWhen,
  type LegendEntry,
  type TooltipRow,
} from "./shared";

/* ---------- Data components ---------- */

const seriesSchema = z.object({
  name: z.string(),
  values: numbersSchema,
  previous: numbersSchema.optional(),
  mark: z.enum(["line", "area", "bar"]).optional(),
  lows: numbersSchema.optional(),
  highs: numbersSchema.optional(),
});
type SeriesProps = z.infer<typeof seriesSchema>;

export const Series = defineComponent({
  name: "Series",
  props: seriesSchema,
  description:
    "One series; previous is the same points for the previous period. Use null for gaps. mark overrides the chart type to mix bars and a line in the same unit, e.g. Series(\"7-day average\", avg, null, \"line\"). lows/highs shade a band such as a 95% interval: Series(\"Lift\", lift, null, \"line\", lower, upper).",
  component: () => null,
});

const referenceSchema = z.object({
  label: z.string(),
  value: z.number(),
});
type ReferenceProps = z.infer<typeof referenceSchema>;

export const Reference = defineComponent({
  name: "Reference",
  props: referenceSchema,
  description: "A target or SLO line: Reference(\"Target\", 99.5).",
  component: () => null,
});

/* ---------- Shared chart plumbing ---------- */

const AXIS_TICK = { fill: "var(--pdk-ink-muted)", fontSize: 11.5 };

type Row = Record<string, string | number | null>;

/** A 1, 2, 2.5 or 5 × 10ⁿ step close to `raw`. */
function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

/** A rounded y-range around the values, kept at or above zero for positive data. */
function lineDomain(rows: Row[], keys: string[], extra: number[], ceiling?: number, integers = false): [number, number] | undefined {
  const values = [...extra.filter((v) => typeof v === "number")];
  for (const row of rows) for (const key of keys) if (typeof row[key] === "number") values.push(row[key] as number);
  if (!values.length) return undefined;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || Math.abs(high) || 1;
  const step = integers ? Math.max(1, niceStep((spread * 1.6) / 4)) : niceStep((spread * 1.6) / 4);
  let min = Math.floor((low - spread * 0.3) / step) * step;
  if (low >= 0) min = Math.max(0, min);
  let max = Math.ceil((high + spread * 0.15) / step) * step;
  // Shares can't pass 100%: stop the axis there rather than padding to 150%.
  if (ceiling !== undefined && high <= ceiling) max = Math.min(max, ceiling);
  return [min, max];
}

function domainTicks([min, max]: [number, number], integers = false) {
  const step = integers ? Math.max(1, niceStep((max - min) / 4)) : niceStep((max - min) / 4);
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1000; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

const DURATION_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800];

/** Zero-based ticks on whole durations (30s, 1m, 5m, 1h, …) instead of 65s, 130s. */
function durationTicks(rows: Row[], keys: string[], extra: number[] = []): number[] | undefined {
  let max = Math.max(0, ...extra);
  for (const row of rows) for (const key of keys) if (typeof row[key] === "number") max = Math.max(max, row[key] as number);
  if (!max) return undefined;
  const step = DURATION_STEPS.find((candidate) => max / candidate <= 5) ?? Math.ceil(max / 5);
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/**
 * Dots only where a line can't show a value: a lone point between gaps, or a
 * series too short to draw a line. Elsewhere the line carries the data.
 */
function sparseDot(rows: Row[], key: string, color: string) {
  return function SparseDot(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy, index = 0 } = props;
    const value = rows[index]?.[key];
    const before = rows[index - 1]?.[key];
    const after = rows[index + 1]?.[key];
    const lone = typeof value === "number" && (rows.length <= 2 || (typeof before !== "number" && typeof after !== "number"));
    if (!lone || cx === undefined || cy === undefined) return <g key={`${key}-${index}`} />;
    return <circle key={`${key}-${index}`} cx={cx} cy={cy} r={3.5} fill={color} stroke="var(--pdk-surface)" strokeWidth={1.5} />;
  };
}

/** Whole-number data gets whole-number ticks (no "0.2 signups"). */
function allIntegers(rows: Row[], keys: string[]) {
  return rows.every((row) => keys.every((key) => typeof row[key] !== "number" || Number.isInteger(row[key])));
}

/** The rendered width of an element, kept current as it resizes. */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Width of a label once WrappedTick splits it onto two lines, in px at 11px. */
function wrappedLabelWidth(label: string) {
  const words = label.split(" ");
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : words;
  return Math.max(...lines.map((line) => line.length)) * 6.4;
}

/** An x-axis tick that wraps a multi-word label onto two lines instead of colliding. */
function WrappedTick({ x, y, payload, angled, band }: { x?: number; y?: number; payload?: { value: string }; angled?: boolean; band?: number }) {
  if (angled) {
    return (
      <text x={x} y={y} dy={10} textAnchor="end" fill="var(--pdk-ink-muted)" fontSize={11} transform={`rotate(-35 ${x} ${y})`}>
        {payload?.value}
      </text>
    );
  }
  const text = String(payload?.value ?? "");
  const words = text.split(" ");
  // Split onto two lines only when the label doesn't fit its column on one.
  const fits = !band || text.length * 6.4 <= band - 6;
  const lines = !fits && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [text];
  return (
    <text x={x} y={y} textAnchor="middle" fill="var(--pdk-ink-muted)" fontSize={11}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 12 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function buildRows(labels: string[], series: SeriesProps[]): Row[] {
  return labels.map((label, i) => {
    const row: Row = { label };
    series.forEach((s, index) => {
      row[`s${index}`] = toNumbers(s.values)[i] ?? null;
      row[`p${index}`] = toNumbers(s.previous)[i] ?? null;
      if (s.lows || s.highs) {
        row[`lo${index}`] = toNumbers(s.lows)[i] ?? null;
        row[`hi${index}`] = toNumbers(s.highs)[i] ?? null;
      }
    });
    return row;
  });
}

function yAxisWidth(rows: Row[], keys: string[], format?: ValueFormat | null) {
  let longest = 0;
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number") longest = Math.max(longest, formatValue(value, format, { axis: true }).length);
    }
  }
  // Ticks are rounder (and often one step past) the data, and % or $ glyphs run
  // wide, so leave a character of slack.
  return Math.min(80, Math.max(40, (longest + 1) * 7 + 8));
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  format,
  goodWhen,
  showPrevious,
  previousLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  label?: string;
  series: SeriesProps[];
  format?: ValueFormat | null;
  goodWhen?: GoodWhen;
  showPrevious: boolean;
  previousLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const rows: TooltipRow[] = series.map((s, i) => ({
    name: s.name,
    color: seriesColor(i),
    value: row[`s${i}`] as number | null,
    previous: showPrevious ? (row[`p${i}`] as number | null) : null,
  }));
  if (showPrevious && series.length === 1 && typeof row.p0 === "number") {
    rows.push({ name: previousLabel, color: MUTED_COLOR, value: row.p0 as number, dashed: true });
  }
  return <TooltipCard title={String(label ?? row.label)} rows={rows} format={format} goodWhen={goodWhen} />;
}

function hasPrevious(series: SeriesProps[]) {
  return series.some((s) => toNumbers(s.previous).some((value) => value !== null));
}

function legendFor(series: SeriesProps[], showPrevious: boolean, previousLabel: string, bars = false): LegendEntry[] {
  const entries: LegendEntry[] = series.slice(0, 8).map((s, i) => ({ name: s.name, color: seriesColor(i) }));
  if (series.length > 8) entries.push({ name: `${series.length - 8} more`, color: MUTED_COLOR });
  if (showPrevious) {
    // Bars draw the previous period as faded bars, lines as dashed lines: the key matches the mark.
    // With several series, previous bars are each series' own hue, faded; the key shows a faded swatch.
    const color = series.length === 1 ? MUTED_COLOR : bars ? "color-mix(in srgb, var(--pdk-series-1) 40%, transparent)" : "var(--pdk-ink-muted)";
    entries.push({ name: series.length > 1 && bars ? `${previousLabel} (faded)` : previousLabel, color, dashed: !bars });
  }
  return entries;
}

/** The previous-period mark colour: the muted grey for one series, a faded own hue for several. */
const previousColor = (index: number, count: number) => (count === 1 ? MUTED_COLOR : seriesColor(index));
const previousOpacity = (count: number) => (count === 1 ? 1 : 0.45);

/* ---------- TimeSeries ---------- */

const timeSeriesSchema = z.object({
  labels: z.array(z.string()),
  series: z.array(Series.ref),
  type: z.enum(["line", "area", "bar"]).optional(),
  format: formatSchema.optional(),
  stacked: z.boolean().optional(),
  references: z.array(Reference.ref).optional(),
  height: z.number().optional(),
  goodWhen: goodWhenSchema.optional(),
});

export const TimeSeries = defineComponent({
  name: "TimeSeries",
  props: timeSeriesSchema,
  description:
    "A metric over time. type \"line\" (default) for rates, \"area\" for volumes (stacked for parts of a whole), \"bar\" for counts per period.",
  component: function TimeSeriesView({ props }: ComponentRenderProps<z.infer<typeof timeSeriesSchema>>) {
    const compare = useCompare();
    const gradientId = useId().replace(/:/g, "");
    const labels = toStrings(props.labels);
    const series = useMemo(() => nodeList<SeriesProps>(props.series), [props.series]);
    const references = nodeList<ReferenceProps>(props.references);
    const rows = useMemo(() => buildRows(labels, series), [labels, series]);
    if (!labels.length || !series.length) return <Empty />;

    const type = props.type ?? "line";
    const showPrevious = compare.enabled && hasPrevious(series);
    const keys = series.flatMap((s, i) => [`s${i}`, ...(showPrevious ? [`p${i}`] : []), ...(s.lows || s.highs ? [`lo${i}`, `hi${i}`] : [])]);
    const height = props.height ?? 260;
    const stackId = props.stacked ? "stack" : undefined;
    const count = series.length;
    const lastBar = series.reduce((last, s, i) => ((s.mark ?? type) === "bar" ? i : last), -1);
    // Bars and areas encode size from zero; a line only encodes change, so zoom
    // to the data (plus references) or every rate looks flat.
    const linesOnly = series.every((s) => (s.mark ?? type) === "line");
    const dense = labels.length > 14;
    const overlapGhosts = showPrevious && dense && !props.stacked && series.filter((s) => (s.mark ?? type) === "bar").length === 1;
    const domain = linesOnly ? lineDomain(rows, keys, references.map((reference) => reference.value), isRateFormat(props.format) ? (isRatioFormat(props.format) ? 1 : 100) : undefined, allIntegers(rows, keys)) : undefined;

    return (
      <div className="pdk-chart">
        <Legend entries={legendFor(series, showPrevious, compare.label, type === "bar")} />
        <div className="pdk-chart-plot" style={{ minHeight: height, maxHeight: height * 1.6, marginTop: count > 1 || showPrevious ? 10 : 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* Recharts orders bars by mount order: remount when ghost bars come and go so previous stays first. */}
            <ComposedChart key={showPrevious ? "compare" : "plain"} data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap={dense ? "18%" : "28%"}>
              {/* Dense series draw the previous period behind each bar on its own hidden axis, not beside it. */}
              {overlapGhosts ? <XAxis xAxisId="ghost" dataKey="label" hide /> : null}
              <defs>
                {series.map((_, i) => (
                  <linearGradient key={i} id={`${gradientId}-${i}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={seriesColor(i)} stopOpacity={props.stacked ? 0.55 : 0.2} />
                    <stop offset="100%" stopColor={seriesColor(i)} stopOpacity={props.stacked ? 0.35 : 0.01} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--pdk-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickMargin={10}
                minTickGap={20}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickMargin={6}
                tickCount={5}
                domain={domain}
                allowDecimals={!allIntegers(rows, keys)}
                ticks={domain ? domainTicks(domain, allIntegers(rows, keys)) : isDurationFormat(props.format) ? durationTicks(rows, keys, references.map((r) => r.value)) : undefined}
                width={yAxisWidth(rows, keys, props.format)}
                tickFormatter={(value: number) => formatValue(value, props.format, { axis: true })}
              />
              <Tooltip
                cursor={type === "bar" ? { fill: "var(--pdk-surface-subtle)" } : { stroke: "var(--pdk-border-strong)", strokeWidth: 1 }}
                content={(tooltip) => (
                  <ChartTooltip
                    {...(tooltip as object)}
                    series={series}
                    format={props.format}
                    goodWhen={props.goodWhen}
                    showPrevious={showPrevious}
                    previousLabel={compare.label}
                  />
                )}
              />
              {references.map((reference) => (
                <ReferenceLine
                  key={`${reference.label}-${reference.value}`}
                  y={reference.value}
                  stroke="var(--pdk-ink-secondary)"
                  strokeWidth={1}
                  strokeOpacity={0.6}
                  label={{
                    value: `${reference.label} · ${formatValue(reference.value, props.format)}`,
                    position: "insideTopRight",
                    fill: "var(--pdk-ink-secondary)",
                    fontSize: 11,
                    stroke: "var(--pdk-surface)",
                    strokeWidth: 4,
                    paintOrder: "stroke",
                  }}
                />
              ))}
              {showPrevious
                ? series.map((s, i) =>
                    (s.mark ?? type) === "bar" ? (
                      // Stacked charts get one stacked ghost per category, not one ghost per series.
                      <Bar
                        key={`p${i}`}
                        dataKey={`p${i}`}
                        xAxisId={overlapGhosts ? "ghost" : undefined}
                        stackId={props.stacked ? "previous" : undefined}
                        fill={previousColor(i, count)}
                        fillOpacity={count === 1 ? 0.55 : 0.3}
                        stroke={props.stacked ? "var(--pdk-surface)" : undefined}
                        strokeWidth={props.stacked ? 2 : 0}
                        radius={props.stacked && i < lastBar ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                        maxBarSize={20}
                        isAnimationActive={false}
                      />
                    ) : null,
                  )
                : null}
              {series.map((s, i) => {
                const mark = s.mark ?? type;
                return mark === "bar" ? (
                  <Bar
                    key={s.name}
                    dataKey={`s${i}`}
                    name={s.name}
                    stackId={stackId}
                    fill={seriesColor(i)}
                    stroke={props.stacked ? "var(--pdk-surface)" : undefined}
                    strokeWidth={props.stacked ? 2 : 0}
                    radius={props.stacked && i < lastBar ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                ) : mark === "area" ? (
                  <Area
                    key={s.name}
                    dataKey={`s${i}`}
                    name={s.name}
                    type="monotone"
                    stackId={stackId}
                    stroke={seriesColor(i)}
                    strokeWidth={2}
                    fill={`url(#${gradientId}-${i})`}
                    connectNulls={false}
                    dot={sparseDot(rows, `s${i}`, seriesColor(i))}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--pdk-surface)" }}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    key={s.name}
                    dataKey={`s${i}`}
                    name={s.name}
                    type="monotone"
                    stroke={seriesColor(i)}
                    strokeWidth={i < 8 ? 2 : 1.25}
                    connectNulls={false}
                    dot={sparseDot(rows, `s${i}`, seriesColor(i))}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--pdk-surface)" }}
                    isAnimationActive={false}
                  />
                );
              })}
              {series.map((s, i) =>
                s.lows || s.highs ? (
                  // A range band (e.g. a 95% interval) under its line, in the line's hue.
                  <Area
                    key={`band${i}`}
                    dataKey={(row: Row) => [row[`lo${i}`], row[`hi${i}`]]}
                    type="monotone"
                    stroke="none"
                    fill={seriesColor(i)}
                    fillOpacity={0.14}
                    activeDot={false}
                    legendType="none"
                    tooltipType="none"
                    isAnimationActive={false}
                  />
                ) : null,
              )}
              {showPrevious && type !== "bar"
                ? series.map((_, i) =>
                    props.stacked ? (
                      // Stacked series compare stacked: each dashed edge sits on the previous period's stack.
                      <Area
                        key={`p${i}`}
                        dataKey={`p${i}`}
                        type="monotone"
                        stackId="previous"
                        stroke={previousColor(i, count)}
                        strokeOpacity={previousOpacity(count)}
                        strokeWidth={1.75}
                        strokeDasharray="4 4"
                        fill="none"
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                      />
                    ) : (
                      <Line
                        key={`p${i}`}
                        dataKey={`p${i}`}
                        type="monotone"
                        stroke={previousColor(i, count)}
                        strokeOpacity={previousOpacity(count)}
                        strokeWidth={1.75}
                        strokeDasharray="4 4"
                        dot={sparseDot(rows, `p${i}`, previousColor(i, count))}
                        activeDot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ),
                  )
                : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
});

/* ---------- Bars: categorical comparison ---------- */

const barsSchema = z.object({
  labels: z.array(z.string()),
  series: z.array(Series.ref),
  format: formatSchema.optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  stacked: z.boolean().optional(),
  height: z.number().optional(),
  goodWhen: goodWhenSchema.optional(),
  references: z.array(Reference.ref).optional(),
});

export const Bars = defineComponent({
  name: "Bars",
  props: barsSchema,
  description:
    "Values across categories. Horizontal (default) for long labels and rankings; vertical for short labels and ordered buckets (histograms). references draw lines such as a 1.0x break-even.",
  component: function BarsView({ props }: ComponentRenderProps<z.infer<typeof barsSchema>>) {
    const [chartRef, width] = useWidth<HTMLDivElement>();
    const compare = useCompare();
    const labels = toStrings(props.labels);
    const series = useMemo(() => nodeList<SeriesProps>(props.series), [props.series]);
    const rows = useMemo(() => buildRows(labels, series), [labels, series]);
    const references = nodeList<ReferenceProps>(props.references);
    // Horizontal single-series bars print their value at the bar's end, so small
    // bars next to an outlier stay readable without hovering.
    const valueLabels = (props.orientation ?? "horizontal") === "horizontal" && series.length === 1 && !props.stacked && labels.length <= 16;
    const chartRows = valueLabels ? rows.map((row) => ({ ...row, t0: typeof row.s0 === "number" ? formatValue(row.s0, props.format) : "" })) : rows;
    if (!labels.length || !series.length) return <Empty />;
    if (rows.every((row) => series.every((_, i) => !row[`s${i}`]))) return <Empty>Every value is zero in this period</Empty>;

    const horizontal = (props.orientation ?? "horizontal") === "horizontal";
    const showPrevious = compare.enabled && hasPrevious(series);
    const count = series.length;
    const stackId = props.stacked ? "stack" : undefined;
    const longestLabel = Math.max(...labels.map((label) => label.length));
    // Vertical bars: tilt category labels only when a wrapped label is wider than its column.
    const band = width ? (width - 64) / Math.max(1, labels.length) : 0;
    const angled = !horizontal && band > 0 && Math.max(...labels.map(wrappedLabelWidth)) > band - 6;
    const height = props.height ?? (horizontal ? Math.max(160, labels.length * (count > 1 || showPrevious ? 44 : 34) + 24) : 260);
    const radius = (i: number): [number, number, number, number] =>
      props.stacked && i < count - 1 ? [0, 0, 0, 0] : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];

    const valueAxis = {
      tickLine: false,
      axisLine: false,
      tick: AXIS_TICK,
      tickCount: 5,
      allowDecimals: !allIntegers(rows, series.map((_, i) => `s${i}`)),
      ticks: isDurationFormat(props.format) ? durationTicks(rows, series.map((_, i) => `s${i}`).concat(showPrevious ? series.map((_, i) => `p${i}`) : []), references.map((r) => r.value)) : undefined,
      tickFormatter: (value: number) => formatValue(value, props.format, { axis: true }),
    };

    return (
      <div className="pdk-chart" ref={chartRef}>
        <Legend entries={legendFor(series, showPrevious, compare.label, true)} />
        <div className="pdk-chart-plot" style={{ minHeight: height, maxHeight: height * 1.6, marginTop: count > 1 || showPrevious ? 10 : 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              key={showPrevious ? "compare" : "plain"}
              data={chartRows}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: horizontal && references.length ? 24 : 12, right: valueLabels ? 64 : 12, bottom: 0, left: 0 }}
              barGap={2}
              barCategoryGap="24%"
            >
              <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="var(--pdk-grid)" />
              {horizontal ? (
                <>
                  <XAxis type="number" {...valueAxis} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ ...AXIS_TICK, fill: "var(--pdk-ink-secondary)" }}
                    width={Math.min(190, Math.max(64, longestLabel * 7.4 + 14))}
                  />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={<WrappedTick angled={angled} band={band} />} height={angled ? 56 : 36} interval={0} />
                  <YAxis {...valueAxis} width={yAxisWidth(rows, series.map((_, i) => `s${i}`), props.format)} />
                </>
              )}
              <Tooltip
                cursor={{ fill: "var(--pdk-surface-subtle)" }}
                content={(tooltip) => (
                  <ChartTooltip
                    {...(tooltip as object)}
                    series={series}
                    format={props.format}
                    goodWhen={props.goodWhen}
                    showPrevious={showPrevious}
                    previousLabel={compare.label}
                  />
                )}
              />
              {references.map((reference) => (
                <ReferenceLine
                  key={`${reference.label}-${reference.value}`}
                  {...(horizontal ? { x: reference.value } : { y: reference.value })}
                  stroke="var(--pdk-ink-secondary)"
                  strokeOpacity={0.6}
                  label={{
                    value: `${reference.label} · ${formatValue(reference.value, props.format)}`,
                    position: horizontal ? "top" : "insideTopRight",
                    fill: "var(--pdk-ink-secondary)",
                    fontSize: 11,
                    stroke: "var(--pdk-surface)",
                    strokeWidth: 4,
                    paintOrder: "stroke",
                  }}
                  ifOverflow="extendDomain"
                />
              ))}
              {showPrevious
                ? series.map((_, i) => (
                    <Bar
                      key={`p${i}`}
                      dataKey={`p${i}`}
                      fill={previousColor(i, count)}
                      fillOpacity={count === 1 ? 0.6 : 0.3}
                      radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                      maxBarSize={12}
                      isAnimationActive={false}
                    />
                  ))
                : null}
              {series.map((s, i) => (
                <Bar
                  key={s.name}
                  dataKey={`s${i}`}
                  name={s.name}
                  stackId={stackId}
                  fill={seriesColor(i)}
                  stroke={props.stacked ? "var(--pdk-surface)" : undefined}
                  strokeWidth={props.stacked ? 2 : 0}
                  radius={radius(i)}
                  maxBarSize={22}
                  isAnimationActive={false}
                >
                  {valueLabels ? (
                    <LabelList dataKey="t0" position="right" offset={8} fontSize={11.5} fill="var(--pdk-ink-secondary)" />
                  ) : null}
                </Bar>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
});

/* ---------- Donut: part to whole, at most 3 parts + Other ---------- */

const donutSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
  format: formatSchema.optional(),
  centerLabel: z.string().optional(),
});

const MAX_SLICES = 3;

export const Donut = defineComponent({
  name: "Donut",
  props: donutSchema,
  description:
    "Part of a whole with ≤3 parts; extra parts fold into Other.",
  component: function DonutView({ props }: ComponentRenderProps<z.infer<typeof donutSchema>>) {
    const labels = toStrings(props.labels);
    const values = toNumbers(props.values).map((value) => value ?? 0);
    const parts = labels.map((label, i) => ({ label, value: values[i] ?? 0 })).filter((part) => part.value > 0);
    if (!parts.length) return <Empty />;
    // Keep the given order for colour stability; fold the smallest beyond three into "Other".
    const keep = [...parts].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES).map((part) => part.label);
    const kept = parts.filter((part) => keep.includes(part.label));
    const other = parts.filter((part) => !keep.includes(part.label)).reduce((sum, part) => sum + part.value, 0);
    const slices = [
      ...kept.map((part, i) => ({ ...part, color: seriesColor(i) })),
      ...(other > 0 ? [{ label: "Other", value: other, color: MUTED_COLOR }] : []),
    ];
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 168, height: 168, flex: "none" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius={58}
                outerRadius={80}
                paddingAngle={slices.length > 1 ? 2 : 0}
                cornerRadius={4}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((slice) => (
                  <Cell key={slice.label} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const slice = active ? (payload?.[0]?.payload as (typeof slices)[number] | undefined) : undefined;
                  if (!slice) return null;
                  return (
                    <TooltipCard
                      title={slice.label}
                      rows={[{ name: "Share", color: slice.color, value: (slice.value / total) * 100 }]}
                      format="percent"
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeContent: "center",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>{formatValue(total, props.format)}</span>
            <span style={{ fontSize: 11.5, color: "var(--pdk-ink-muted)" }}>{props.centerLabel ?? "Total"}</span>
          </div>
        </div>
        <ul style={{ flex: 1, minWidth: 160, margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
          {slices.map((slice) => (
            <li key={slice.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--pdk-ink-secondary)" }}>
                <span className="pdk-legend-swatch" style={{ background: slice.color }} />
                {slice.label}
              </span>
              <span style={{ display: "inline-flex", gap: 8, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontWeight: 600 }}>{formatValue(slice.value, props.format)}</span>
                <span style={{ color: "var(--pdk-ink-muted)", width: 44, textAlign: "right" }}>
                  {formatValue((slice.value / total) * 100, "percent")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  },
});

/* ---------- Waterfall: how a total moved ---------- */

const waterfallSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
  format: formatSchema.optional(),
  endLabel: z.string().optional(),
});

export const Waterfall = defineComponent({
  name: "Waterfall",
  props: waterfallSchema,
  description:
    "How a total moved: the first value is the starting total, the rest are signed changes, the end total is computed. E.g. Waterfall([\"Start MRR\", \"New\", \"Expansion\", \"Churn\"], [398200, 18400, 9100, -9300], \"currency-compact\", \"End MRR\").",
  component: function WaterfallView({ props }: ComponentRenderProps<z.infer<typeof waterfallSchema>>) {
    const [chartRef, width] = useWidth<HTMLDivElement>();
    const labels = toStrings(props.labels);
    const values = toNumbers(props.values).map((value) => value ?? 0);
    if (!labels.length) return <Empty />;
    let running = 0;
    const rows = labels.map((label, i) => {
      const value = values[i] ?? 0;
      if (i === 0) {
        running = value;
        return { label, base: 0, bar: value, value, kind: "total" as const };
      }
      const start = running;
      running += value;
      return { label, base: Math.min(start, running), bar: Math.abs(value), value, kind: value >= 0 ? ("up" as const) : ("down" as const) };
    });
    rows.push({ label: props.endLabel ?? "End", base: 0, bar: running, value: running, kind: "total" });
    const labelled = rows.map((row) => {
      const text = formatValue(row.value, props.format, { axis: true });
      return { ...row, text: row.kind === "up" ? `+${text}` : text };
    });
    const color = { total: "var(--pdk-series-1)", up: "var(--pdk-series-2)", down: "var(--pdk-series-6)" };
    // Zoom to where the total moves: changes are small next to the totals, so a
    // zero-based axis would turn every change bar into a sliver.
    const levels = labelled.flatMap((row) => (row.kind === "total" ? [row.value] : [row.base, row.base + row.bar]));
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    // Leave the totals a solid base below the lowest level, about 1.5× the movement.
    const pad = (high - low || Math.abs(high) || 1) * 1.5;
    const domainMin = Math.max(0, low - pad);
    // Tilt the labels only when a wrapped label is wider than its column.
    const band = width ? (width - 64) / Math.max(1, labelled.length) : 0;
    const angled = band > 0 && Math.max(...labelled.map((row) => wrappedLabelWidth(row.label))) > band - 6;
    const zoomed = labelled.map((row) =>
      row.kind === "total" ? { ...row, base: domainMin, bar: row.value - domainMin } : row,
    );

    return (
      <div className="pdk-chart" ref={chartRef}>
        <div className="pdk-legend">
          <span className="pdk-legend-item"><span className="pdk-legend-swatch" style={{ background: color.total }} />Total</span>
          <span className="pdk-legend-item"><span className="pdk-legend-swatch" style={{ background: color.up }} />Increase</span>
          <span className="pdk-legend-item"><span className="pdk-legend-swatch" style={{ background: color.down }} />Decrease</span>
        </div>
        <div className="pdk-chart-plot" style={{ minHeight: 260, maxHeight: 416, marginTop: 10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={zoomed} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--pdk-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={<WrappedTick angled={angled} band={band} />}
                height={angled ? 56 : 36}
                interval={0}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickCount={5}
                width={56}
                domain={[domainMin, "auto"]}
                allowDataOverflow
                tickFormatter={(value: number) => formatValue(value, props.format, { axis: true })}
              />
              <Tooltip
                cursor={{ fill: "var(--pdk-surface-subtle)" }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                  if (!row) return null;
                  const sign = row.kind === "up" ? "+" : "";
                  return (
                    <div className="pdk-tooltip">
                      <div className="pdk-tooltip-title">{row.label}</div>
                      <div className="pdk-tooltip-row">
                        <span>{row.kind === "total" ? "Total" : "Change"}</span>
                        <span className="pdk-tooltip-value">{sign}{formatValue(row.value, props.format)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar
                dataKey="bar"
                stackId="w"
                radius={[4, 4, 4, 4]}
                maxBarSize={40}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.label} fill={color[row.kind]} />
                ))}
                <LabelList dataKey="text" position="top" fontSize={11} fill="var(--pdk-ink-secondary)" />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
});

/* ---------- Intervals: estimates with confidence ranges ---------- */

const intervalsSchema = z.object({
  labels: z.array(z.string()),
  estimates: z.array(z.number()),
  lows: z.array(z.number()),
  highs: z.array(z.number()),
  format: formatSchema.optional(),
  baseline: z.number().optional(),
  baselineLabel: z.string().optional(),
});

export const Intervals = defineComponent({
  name: "Intervals",
  props: intervalsSchema,
  description:
    "Estimates with confidence intervals (forest plot), e.g. experiment lift. An interval that doesn't cross baseline (default 0) is drawn as significant.",
  component: function IntervalsView({ props }: ComponentRenderProps<z.infer<typeof intervalsSchema>>) {
    const labels = toStrings(props.labels);
    const estimates = toNumbers(props.estimates);
    const lows = toNumbers(props.lows);
    const highs = toNumbers(props.highs);
    if (!labels.length) return <Empty />;
    const baseline = props.baseline ?? 0;
    const all = [...lows, ...highs, baseline].filter((value): value is number => value !== null);
    const span = Math.max(...all) - Math.min(...all) || 1;
    // Round ticks (…, -5, 0, 5, 10, …) and a domain that ends on them.
    const step = niceStep(span / 4);
    const min = Math.floor((Math.min(...all) - span * 0.04) / step) * step;
    const max = Math.ceil((Math.max(...all) + span * 0.04) / step) * step;
    const x = (value: number) => `${((value - min) / (max - min)) * 100}%`;
    const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);

    return (
      <div style={{ display: "grid", gap: 6 }}>
        {labels.map((label, i) => {
          const low = lows[i];
          const high = highs[i];
          const estimate = estimates[i];
          if (low === null || high === null || estimate === null) return null;
          const significant = low > baseline || high < baseline;
          const color = significant ? "var(--pdk-series-1)" : "var(--pdk-muted-mark)";
          return (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.8fr) 3fr 168px", alignItems: "center", gap: 14, fontSize: 13 }}>
              <span style={{ fontWeight: 500, lineHeight: 1.3, overflowWrap: "anywhere" }}>{label}</span>
              <div style={{ position: "relative", height: 28 }}>
                <span style={{ position: "absolute", top: 0, bottom: 0, left: x(baseline), borderLeft: "1px solid var(--pdk-border-strong)" }} />
                <span style={{ position: "absolute", top: 13, height: 2, borderRadius: 2, left: x(low), width: `calc(${x(high)} - ${x(low)})`, background: color }} />
                <span style={{ position: "absolute", top: 8, height: 12, left: x(low), borderLeft: `2px solid ${color}` }} />
                <span style={{ position: "absolute", top: 8, height: 12, left: x(high), borderLeft: `2px solid ${color}`, transform: "translateX(-2px)" }} />
                <span style={{ position: "absolute", top: 9, left: x(estimate), width: 10, height: 10, borderRadius: "50%", background: color, transform: "translateX(-5px)", boxShadow: "0 0 0 2px var(--pdk-surface)" }} />
              </div>
              <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" }}>
                <strong style={{ fontWeight: 600 }}>{formatValue(estimate, props.format)}</strong>{" "}
                <span style={{ color: "var(--pdk-ink-muted)" }}>
                  [{formatValue(low, props.format)}, {formatValue(high, props.format)}]
                </span>
              </span>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.8fr) 3fr 168px", gap: 14 }}>
          <span />
          <div style={{ position: "relative", height: 16, fontSize: 11, color: "var(--pdk-ink-muted)" }}>
            {ticks.map((tick) => (
              <span key={tick} style={{ position: "absolute", left: x(tick), transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
                {formatValue(tick, props.format, { axis: true })}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "var(--pdk-ink-muted)", textAlign: "right" }}>
            {props.baselineLabel ?? "No effect"}: {formatValue(baseline, props.format)}
          </span>
        </div>
      </div>
    );
  },
});
