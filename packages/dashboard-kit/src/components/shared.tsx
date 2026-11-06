"use client";

import { createContext, use, useId, useMemo, useState, type ReactNode } from "react";

import { computeDelta, deltaTone, formatValue, type ValueFormat } from "../format";
import { MUTED_COLOR } from "../theme";

/* ---------- Comparison state ---------- */

type CompareState = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** What the previous period is called in legends and tooltips. */
  label: string;
  setLabel: (label: string) => void;
};

const CompareContext = createContext<CompareState>({
  enabled: false,
  setEnabled: () => {},
  label: "Previous period",
  setLabel: () => {},
});

/**
 * Holds the "compare to previous period" switch for a whole dashboard. It's
 * presentation only (the previous-period data is already in the program), so
 * it lives in React rather than in OpenUI state.
 */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState("Previous period");
  const value = useMemo(() => ({ enabled, setEnabled, label, setLabel }), [enabled, label]);
  return <CompareContext value={value}>{children}</CompareContext>;
}

export const useCompare = () => use(CompareContext);

/* ---------- Helpers ---------- */

export function toNumbers(values: unknown): (number | null)[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
}

export function toStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => (value === null || value === undefined ? "" : String(value)));
}

/** Props of a child component node (e.g. a Series inside a chart). */
export function nodeProps<T>(node: unknown): T | null {
  if (!node || typeof node !== "object") return null;
  const props = (node as { props?: unknown }).props;
  return props && typeof props === "object" ? (props as T) : null;
}

export function nodeList<T>(nodes: unknown): T[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => nodeProps<T>(node)).filter((props): props is T => props !== null);
}

/* ---------- Delta badge ---------- */

const ArrowUp = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M6 9.5V2.5M6 2.5 3 5.5M6 2.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ArrowDown = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M6 2.5v7M6 9.5 3 6.5M6 9.5l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type GoodWhen = "up" | "down" | "neutral";

export function DeltaBadge({
  current,
  previous,
  format,
  goodWhen = "up",
  inline = false,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  format?: ValueFormat | null;
  goodWhen?: GoodWhen;
  inline?: boolean;
}) {
  if (typeof current !== "number" || typeof previous !== "number") return null;
  const delta = computeDelta(current, previous, format);
  if (!delta) return null;
  const tone = deltaTone(delta.direction, goodWhen);
  return (
    <span
      className={`pdk-delta pdk-delta-${tone}${inline ? " pdk-delta-inline" : ""}`}
      title={`Previous: ${formatValue(previous, format)}`}
    >
      {delta.direction === "up" ? <ArrowUp /> : delta.direction === "down" ? <ArrowDown /> : null}
      {delta.text}
    </span>
  );
}

/* ---------- Legend ---------- */

export type LegendEntry = { name: string; color: string; dashed?: boolean };

export function Legend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length < 2) return null;
  return (
    <div className="pdk-legend" role="list">
      {entries.map((entry) => (
        <span key={`${entry.name}-${entry.dashed ? "prev" : "cur"}`} className="pdk-legend-item" role="listitem">
          {entry.dashed ? (
            <span className="pdk-legend-line" style={{ borderTopColor: entry.color }} />
          ) : (
            <span className="pdk-legend-swatch" style={{ background: entry.color }} />
          )}
          {entry.name}
        </span>
      ))}
    </div>
  );
}

/* ---------- Tooltip ---------- */

export type TooltipRow = {
  name: string;
  color: string;
  value: number | null | undefined;
  previous?: number | null;
  dashed?: boolean;
};

export function TooltipCard({
  title,
  rows,
  format,
  goodWhen,
  previousLabel,
}: {
  title: string;
  rows: TooltipRow[];
  format?: ValueFormat | null;
  goodWhen?: GoodWhen;
  previousLabel?: string;
}) {
  return (
    <div className="pdk-tooltip">
      <div className="pdk-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.name} className="pdk-tooltip-row">
          <span>
            {row.dashed ? (
              <span className="pdk-legend-line" style={{ borderTopColor: row.color }} />
            ) : (
              <span className="pdk-legend-swatch" style={{ background: row.color }} />
            )}
            {row.name}
          </span>
          <span className="pdk-tooltip-value">
            {formatValue(row.value, format)}
            {typeof row.previous === "number" && typeof row.value === "number" ? (
              <>
                {" "}
                <DeltaBadge current={row.value} previous={row.previous} format={format} goodWhen={goodWhen} inline />
              </>
            ) : null}
          </span>
        </div>
      ))}
      {previousLabel ? <div className="pdk-tooltip-sub">vs {previousLabel.toLowerCase()}</div> : null}
    </div>
  );
}

/* ---------- Sparkline ---------- */

export function Sparkline({
  values,
  previous,
  color = "var(--pdk-series-1)",
  showPrevious = false,
}: {
  values: (number | null)[];
  previous?: (number | null)[];
  color?: string;
  showPrevious?: boolean;
}) {
  const id = `pdk-spark-${useId().replace(/:/g, "")}`;
  const points = values.filter((value): value is number => value !== null);
  if (points.length < 2) return null;
  const all = showPrevious && previous ? [...points, ...previous.filter((v): v is number => v !== null)] : points;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const width = 96;
  const height = 36;
  const pad = 3;
  const path = (series: (number | null)[]) => {
    const step = (width - pad * 2) / Math.max(1, series.length - 1);
    return series
      .map((value, i) => {
        if (value === null) return null;
        const x = pad + i * step;
        const y = max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  };
  const line = path(values);
  const last = line.split(" ").at(-1)?.split(",") ?? ["0", "0"];
  return (
    <svg className="pdk-kpi-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showPrevious && previous ? (
        <polyline points={path(previous)} fill="none" stroke={MUTED_COLOR} strokeWidth="1.5" strokeDasharray="3 3" />
      ) : null}
      <polygon points={`${pad},${height} ${line} ${last[0]},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.75" fill={color} stroke="var(--pdk-surface)" strokeWidth="1.5" />
    </svg>
  );
}

export function Empty({ children = "No data" }: { children?: ReactNode }) {
  return <div className="pdk-empty">{children}</div>;
}
