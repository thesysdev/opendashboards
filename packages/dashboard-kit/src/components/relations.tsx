"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Sankey,
  Scatter as RechartsScatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { z } from "zod/v4";

import { formatSchema, formatValue } from "../format";
import { MUTED_COLOR, seriesColor } from "../theme";
import { Empty, Legend, TooltipCard } from "./shared";

/* ---------- Flow (Sankey) ---------- */

const linkSchema = z.object({ from: z.string(), to: z.string(), value: z.number() });

const flowSchema = z.object({
  links: z.array(linkSchema),
  format: formatSchema.optional(),
  height: z.number().optional(),
});

/** Nodes whose names say "this is where people left" are drawn muted. */
const LOSS = /\b(drop|dropped|exit|exited|lost|churn|churned|bounce|bounced|abandon)/i;

export const Flow = defineComponent({
  name: "Flow",
  props: flowSchema,
  description:
    "Sankey of a quantity between stages: links like {from: \"Paid search\", to: \"Signed up\", value: 1210}. Name loss nodes \"Dropped\", \"Exited\" or \"Churned\" (drawn grey). Keep to ~4 columns and ~15 nodes.",
  component: function FlowView({ props }: ComponentRenderProps<z.infer<typeof flowSchema>>) {
    const [hovered, setHovered] = useState<number | null>(null);
    const data = useMemo(() => {
      const links = (Array.isArray(props.links) ? props.links : []).filter(
        (link) => link && typeof link.value === "number" && link.value > 0 && link.from && link.to,
      );
      const names: string[] = [];
      const indexOf = (name: string) => {
        let index = names.indexOf(name);
        if (index === -1) index = names.push(name) - 1;
        return index;
      };
      const mapped = links.map((link) => ({ source: indexOf(link.from), target: indexOf(link.to), value: link.value }));
      return { nodes: names.map((name) => ({ name })), links: mapped };
    }, [props.links]);

    if (!data.links.length) return <Empty />;
    // Entry nodes (no inbound links) take categorical colours in first-seen order; every later
    // step is the primary hue and losses are grey, so colour says "where people came from".
    const targets = new Set(data.links.map((link) => link.target));
    const entries = data.nodes.map((_, index) => index).filter((index) => !targets.has(index));
    const nodeColor = (index: number, name: string) => {
      if (LOSS.test(name)) return MUTED_COLOR;
      const entry = entries.indexOf(index);
      return entry === -1 ? seriesColor(0) : seriesColor(entry + 1);
    };

    return (
      <div className="pdk-chart" style={{ height: props.height ?? 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            nodePadding={18}
            nodeWidth={10}
            linkCurvature={0.5}
            iterations={64}
            margin={{ top: 8, right: 140, bottom: 8, left: 8 }}
            node={(nodeProps: {
              x: number;
              y: number;
              width: number;
              height: number;
              index: number;
              payload: { name: string; value: number; depth?: number };
            }) => {
              const { x, y, width, height, index, payload } = nodeProps;
              const color = nodeColor(index, payload.name);
              return (
                <g>
                  <rect x={x} y={y} width={width} height={Math.max(height, 2)} rx={3} fill={color} />
                  <text x={x + width + 8} y={y + height / 2} dy={-1} fontSize={12} fill="var(--pdk-ink)" fontWeight={500} stroke="var(--pdk-surface)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
                    {payload.name}
                  </text>
                  <text x={x + width + 8} y={y + height / 2} dy={13} fontSize={11} fill="var(--pdk-ink-muted)" stroke="var(--pdk-surface)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
                    {formatValue(payload.value, props.format ?? "number")}
                  </text>
                </g>
              );
            }}
            link={(linkProps: {
              sourceX: number;
              targetX: number;
              sourceY: number;
              targetY: number;
              sourceControlX: number;
              targetControlX: number;
              linkWidth: number;
              index: number;
              payload: { source: { name: string; index?: number }; target: { name: string } };
            }) => {
              const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = linkProps;
              const lossy = LOSS.test(payload.target.name);
              const sourceIndex = data.nodes.findIndex((node) => node.name === payload.source.name);
              const color = lossy ? MUTED_COLOR : nodeColor(sourceIndex, payload.source.name);
              const active = hovered === null || hovered === index;
              return (
                <path
                  d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(linkWidth, 1)}
                  strokeOpacity={active ? (hovered === index ? 0.5 : 0.28) : 0.1}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ transition: "stroke-opacity 120ms" }}
                />
              );
            }}
          >
            <Tooltip
              content={({ active, payload }) => {
                const item = active ? (payload?.[0]?.payload as { payload?: { source?: { name: string }; target?: { name: string }; value?: number; name?: string } } | undefined) : undefined;
                const inner = item?.payload;
                if (!inner) return null;
                const title = inner.source && inner.target ? `${inner.source.name} → ${inner.target.name}` : (inner.name ?? "");
                return <TooltipCard title={title} rows={[{ name: "Volume", color: "var(--pdk-series-1)", value: inner.value }]} format={props.format ?? "number"} />;
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
    );
  },
});

/* ---------- Scatter ---------- */

const pointSchema = z.object({
  label: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number().optional(),
  group: z.string().optional(),
});

const scatterSchema = z.object({
  points: z.array(pointSchema),
  xLabel: z.string(),
  yLabel: z.string(),
  xFormat: formatSchema.optional(),
  yFormat: formatSchema.optional(),
  height: z.number().optional(),
});

const MAX_GROUPS = 3;

export const Scatter = defineComponent({
  name: "Scatter",
  props: scatterSchema,
  description:
    "Two measures per item, e.g. campaigns by spend and ROAS sized by signups. At most 3 groups.",
  component: function ScatterView({ props }: ComponentRenderProps<z.infer<typeof scatterSchema>>) {
    const points = (Array.isArray(props.points) ? props.points : []).filter(
      (point) => point && typeof point.x === "number" && typeof point.y === "number",
    );
    if (!points.length) return <Empty />;
    const groups = [...new Set(points.map((point) => point.group ?? ""))].slice(0, MAX_GROUPS);
    const sized = points.some((point) => typeof point.size === "number");
    const labelAll = points.length <= 10;

    return (
      <div className="pdk-chart">
        <Legend entries={groups.filter(Boolean).map((group, i) => ({ name: group, color: seriesColor(i) }))} />
        <div className="pdk-chart-plot" style={{ minHeight: props.height ?? 300, maxHeight: (props.height ?? 300) * 1.6, marginTop: groups.length > 1 ? 10 : 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 18, left: 4 }}>
              <CartesianGrid stroke="var(--pdk-grid)" />
              <XAxis
                type="number"
                dataKey="x"
                name={props.xLabel}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--pdk-ink-muted)", fontSize: 11.5 }}
                tickFormatter={(value: number) => formatValue(value, props.xFormat, { axis: true })}
                label={{ value: props.xLabel, position: "insideBottom", offset: -12, fill: "var(--pdk-ink-muted)", fontSize: 11.5 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={props.yLabel}
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: "var(--pdk-ink-muted)", fontSize: 11.5 }}
                tickFormatter={(value: number) => formatValue(value, props.yFormat, { axis: true })}
                label={{ value: props.yLabel, angle: -90, position: "insideLeft", offset: 10, fill: "var(--pdk-ink-muted)", fontSize: 11.5, style: { textAnchor: "middle" } }}
              />
              <ZAxis type="number" dataKey="size" range={sized ? [60, 520] : [90, 90]} />
              <Tooltip
                cursor={{ strokeDasharray: "0", stroke: "var(--pdk-border-strong)" }}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as z.infer<typeof pointSchema> | undefined) : undefined;
                  if (!point) return null;
                  return (
                    <div className="pdk-tooltip">
                      <div className="pdk-tooltip-title">{point.label}</div>
                      <div className="pdk-tooltip-row"><span>{props.xLabel}</span><span className="pdk-tooltip-value">{formatValue(point.x, props.xFormat)}</span></div>
                      <div className="pdk-tooltip-row"><span>{props.yLabel}</span><span className="pdk-tooltip-value">{formatValue(point.y, props.yFormat)}</span></div>
                      {typeof point.size === "number" ? (
                        <div className="pdk-tooltip-row"><span>Size</span><span className="pdk-tooltip-value">{formatValue(point.size, "number")}</span></div>
                      ) : null}
                    </div>
                  );
                }}
              />
              {groups.map((group, i) => (
                <RechartsScatter
                  key={group || "all"}
                  data={points.filter((point) => (point.group ?? "") === group)}
                  fill={seriesColor(i)}
                  fillOpacity={0.75}
                  stroke="var(--pdk-surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {labelAll ? <LabelList dataKey="label" position="top" offset={8} fontSize={11} fill="var(--pdk-ink-secondary)" /> : null}
                </RechartsScatter>
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
});
