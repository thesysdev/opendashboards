"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { useMemo, useState } from "react";
import { z } from "zod/v4";

import { formatSchema, formatValue, isRateFormat, type ValueFormat } from "../format";
import { goodWhenSchema, numbersSchema, toneSchema, type Tone } from "../schema";
import { MUTED_COLOR, sequentialColor, seriesColor } from "../theme";
import { DeltaBadge, Empty, nodeList, Sparkline, toNumbers, toStrings, useCompare, type GoodWhen } from "./shared";

/* ---------- Funnel ---------- */

const funnelSchema = z.object({
  steps: z.array(z.string()),
  values: z.array(z.number()),
  previous: z.array(z.number()).optional(),
  format: formatSchema.optional(),
});

export const Funnel = defineComponent({
  name: "Funnel",
  props: funnelSchema,
  description:
    "Ordered conversion steps, scaled to the first step, with step-to-step conversion and drop-off.",
  component: function FunnelView({ props }: ComponentRenderProps<z.infer<typeof funnelSchema>>) {
    const compare = useCompare();
    const steps = toStrings(props.steps);
    const values = toNumbers(props.values).map((value) => value ?? 0);
    const previous = toNumbers(props.previous);
    const top = values[0] ?? 0;
    if (!steps.length || !top) return <Empty />;
    const prevTop = previous[0] ?? 0;
    const showPrevious = compare.enabled && prevTop > 0;

    return (
      <div className="pdk-funnel">
        {steps.map((step, i) => {
          const value = values[i] ?? 0;
          const share = value / top;
          const prevShare = showPrevious && typeof previous[i] === "number" ? (previous[i] as number) / prevTop : null;
          const inside = share > 0.18;
          const conversion = i > 0 && values[i - 1] ? value / values[i - 1] : null;
          return (
            <div key={step}>
              {conversion !== null ? (
                <div className="pdk-funnel-link">
                  <span />
                  <span>
                    <strong>{formatValue(conversion * 100, "percent")}</strong> converted
                    {values[i - 1] >= value ? (
                      <span className="pdk-funnel-drop">· −{formatValue(values[i - 1] - value, props.format ?? "number")} dropped</span>
                    ) : (
                      // Re-entry or a step counted independently: more people than the step before.
                      <span className="pdk-funnel-drop" style={{ color: "var(--pdk-ink-muted)" }}>· +{formatValue(value - values[i - 1], props.format ?? "number")} more than the step before</span>
                    )}
                  </span>
                </div>
              ) : null}
              <div className="pdk-funnel-step">
                <div>
                  <div className="pdk-funnel-name">{step}</div>
                  <div className="pdk-funnel-count">{formatValue(value, props.format ?? "number")}</div>
                </div>
                <div className="pdk-funnel-bar" title={`${formatValue(share * 100, "percent")} of ${steps[0]}`}>
                  <div
                    className="pdk-funnel-fill"
                    style={{ width: `${Math.max(share * 100, 0.6)}%`, opacity: 1 - i * (0.5 / Math.max(steps.length - 1, 1)) }}
                  />
                  <span
                    className={`pdk-funnel-pct ${inside ? "pdk-ink-light" : "pdk-ink-dark"}`}
                    style={inside ? { left: 0 } : { left: `${share * 100}%` }}
                  >
                    {formatValue(share * 100, "percent")}
                  </span>
                  {prevShare !== null ? (
                    <span className="pdk-funnel-prev" style={{ left: `${prevShare * 100}%` }} title={`${compare.label}: ${formatValue(prevShare * 100, "percent")}`} />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {showPrevious ? (
          <div className="pdk-legend" style={{ marginTop: 8 }}>
            <span className="pdk-legend-item">
              <span className="pdk-legend-line" style={{ borderTopColor: "var(--pdk-ink-secondary)" }} />
              {compare.label}
            </span>
          </div>
        ) : null}
      </div>
    );
  },
});

/* ---------- Cohorts: retention grid ---------- */

const cohortsSchema = z.object({
  cohorts: z.array(z.string()),
  sizes: z.array(z.number()),
  periods: z.array(z.string()),
  rows: z.array(numbersSchema),
  format: formatSchema.optional(),
});

export const Cohorts = defineComponent({
  name: "Cohorts",
  props: cohortsSchema,
  description:
    "Retention grid: rows[i][j] is the % of cohort i active in period j; null for periods not reached. Periods start at \"Week 0\" or \"Month 0\".",
  component: function CohortsView({ props }: ComponentRenderProps<z.infer<typeof cohortsSchema>>) {
    const cohorts = toStrings(props.cohorts);
    const sizes = toNumbers(props.sizes);
    const periods = toStrings(props.periods);
    const rows = (Array.isArray(props.rows) ? props.rows : []).map((row) => toNumbers(row));
    const format = props.format ?? "percent";
    // Scale colour over the non-trivial cells so period 0 (100%) doesn't flatten the ramp.
    const cells = rows.flatMap((row) => row.slice(1)).filter((value): value is number => value !== null);
    if (!cohorts.length || !periods.length) return <Empty />;
    const min = cells.length ? Math.min(...cells) : 0;
    const max = cells.length ? Math.max(...cells) : 100;

    return (
      <div className="pdk-cohort-wrap">
        <table className="pdk-cohort">
          <thead>
            <tr>
              <th>Cohort</th>
              <th>Size</th>
              {periods.map((period) => (
                <th key={period}>{period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort, i) => (
              <tr key={cohort}>
                <td className="pdk-cohort-label">{cohort}</td>
                <td className="pdk-cohort-size">{formatValue(sizes[i], "number")}</td>
                {periods.map((period, j) => {
                  const value = rows[i]?.[j] ?? null;
                  if (value === null) return <td key={period} className="pdk-cohort-empty" aria-label="Not reached yet" />;
                  const { background, ink } = j === 0 ? { background: "var(--pdk-surface-subtle)", ink: "dark" as const } : sequentialColor(value, min, max);
                  return (
                    <td key={period} className={`pdk-ink-${ink}`} style={{ background }} title={`${cohort}, ${period}: ${formatValue(value, format)}`}>
                      {formatValue(value, format)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
});

/* ---------- Table ---------- */

const columnSchema = z.object({
  label: z.string(),
  values: z.array(z.union([z.string(), z.number(), z.null(), numbersSchema])),
  kind: z.enum(["text", "primary", "number", "bar", "delta", "badge", "sparkline"]).optional(),
  format: formatSchema.optional(),
  tones: z.record(z.string(), toneSchema).optional(),
  goodWhen: goodWhenSchema.optional(),
  total: z.enum(["sum", "average"]).optional(),
});
type ColumnProps = z.infer<typeof columnSchema>;

export const Column = defineComponent({
  name: "Column",
  props: columnSchema,
  description:
    "kind: \"primary\" (bold first column), \"text\", \"number\", \"bar\" (number with inline bar), \"delta\" (signed change coloured by goodWhen), \"badge\" (tones maps statuses to good/bad/warning/info/neutral; plain categories stay neutral), \"sparkline\" (values are number arrays). total \"sum\" or \"average\" only for amounts, never rates or per-unit values like CAC.",
  component: () => null,
});

const tableSchema = z.object({
  columns: z.array(Column.ref),
  pageSize: z.number().optional(),
  totals: z.boolean().optional(),
  search: z.string().optional(),
});

function DeltaCell({ value, format, goodWhen }: { value: number; format?: ValueFormat | null; goodWhen?: GoodWhen }) {
  const rate = isRateFormat(format);
  const text = rate ? `${value > 0 ? "+" : ""}${formatValue(value, { type: "number", decimals: 1 })} pts` : `${value > 0 ? "+" : ""}${formatValue(value, format ?? "percent")}`;
  const direction = Math.abs(value) < 0.05 ? "flat" : value > 0 ? "up" : "down";
  const tone = direction === "flat" || goodWhen === "neutral" ? "neutral" : (direction === "up") === ((goodWhen ?? "up") === "up") ? "good" : "bad";
  return <span className={`pdk-delta pdk-delta-${tone} pdk-delta-inline`}>{text}</span>;
}

export const Table = defineComponent({
  name: "Table",
  props: tableSchema,
  description:
    "Sortable, paged table (default pageSize 10). totals adds a totals row for Columns that set total. search takes a SearchFilter's $variable.",
  component: function TableView({ props }: ComponentRenderProps<z.infer<typeof tableSchema>>) {
    // Filtered values can be null for a render while $state settles; treat them as empty.
    const columns = useMemo(
      () => nodeList<ColumnProps>(props.columns).map((column) => ({ ...column, values: Array.isArray(column.values) ? column.values : [] })),
      [props.columns],
    );
    const rowCount = Math.max(0, ...columns.map((column) => column.values.length));
    const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);
    const [page, setPage] = useState(0);
    const pageSize = props.pageSize ?? 10;

    const query = typeof props.search === "string" ? props.search.trim().toLowerCase() : "";
    const order = useMemo(() => {
      let indexes = Array.from({ length: rowCount }, (_, i) => i);
      // A search (from a SearchFilter) keeps rows where any text cell matches.
      if (query) indexes = indexes.filter((row) => columns.some((column) => typeof column.values[row] === "string" && (column.values[row] as string).toLowerCase().includes(query)));
      if (!sort) return indexes;
      const values = columns[sort.column]?.values ?? [];
      return indexes.sort((a, b) => {
        const x = values[a];
        const y = values[b];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        if (Array.isArray(x) || Array.isArray(y)) return 0;
        const result = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -result : result;
      });
    }, [columns, rowCount, sort, query]);

    if (!columns.length || !rowCount) return <Empty />;
    if (!order.length) return <Empty>No rows match “{props.search}”</Empty>;
    const pages = Math.ceil(order.length / pageSize);
    const safePage = Math.min(page, pages - 1);
    const visible = order.slice(safePage * pageSize, safePage * pageSize + pageSize);
    const numeric = (column: ColumnProps) => ["number", "bar", "delta"].includes(column.kind ?? (column.values.some((v) => typeof v === "number") ? "number" : "text"));
    const max = (column: ColumnProps) => Math.max(...column.values.filter((v): v is number => typeof v === "number"), 0);

    const cell = (column: ColumnProps, value: unknown) => {
      const kind = column.kind ?? (typeof value === "number" ? "number" : "text");
      if (value === null || value === undefined || value === "") return <span className="pdk-cell-muted">—</span>;
      switch (kind) {
        case "primary":
          return <span className="pdk-cell-primary">{String(value)}</span>;
        case "badge": {
          const tone: Tone = column.tones?.[String(value)] ?? "neutral";
          return <span className={`pdk-badge pdk-badge-${tone}`}>{String(value)}</span>;
        }
        case "sparkline":
          return Array.isArray(value) ? (
            <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
              <Sparkline values={toNumbers(value)} />
            </span>
          ) : null;
        case "delta":
          return typeof value === "number" ? <DeltaCell value={value} format={column.format} goodWhen={column.goodWhen} /> : String(value);
        case "bar": {
          const top = max(column);
          return (
            <span className="pdk-cell-bar">
              <span style={{ minWidth: 56, textAlign: "right" }}>{formatValue(value, column.format)}</span>
              <span className="pdk-cell-bar-track">
                <span className="pdk-cell-bar-fill" style={{ width: `${top && typeof value === "number" ? (value / top) * 100 : 0}%` }} />
              </span>
            </span>
          );
        }
        default:
          return typeof value === "number" ? formatValue(value, column.format) : String(value);
      }
    };

    return (
      <div className="pdk-card-body">
        <div className="pdk-table-wrap">
          <table className="pdk-table">
            <thead>
              <tr>
                {columns.map((column, c) => (
                  <th key={column.label} className={numeric(column) ? "pdk-num" : undefined} aria-sort={sort?.column === c ? (sort.desc ? "descending" : "ascending") : undefined}>
                    <button
                      type="button"
                      onClick={() => {
                        setPage(0);
                        setSort((current) =>
                          current?.column === c ? { column: c, desc: !current.desc } : { column: c, desc: numeric(column) },
                        );
                      }}
                    >
                      {column.label}
                      <span aria-hidden className="pdk-sort">
                        {sort?.column === c && !sort.desc ? "▲" : "▼"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row}>
                  {columns.map((column) => (
                    <td key={column.label} className={numeric(column) ? "pdk-num" : undefined}>
                      {cell(column, column.values[row])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {props.totals && columns.some((column) => column.total) ? (
              <tfoot>
                <tr>
                  {columns.map((column, c) => {
                    const numbers = order.map((row) => column.values[row]).filter((v): v is number => typeof v === "number");
                    const sum = numbers.reduce((total, v) => total + v, 0);
                    const value = column.total === "sum" ? sum : column.total === "average" && numbers.length ? sum / numbers.length : null;
                    return (
                      <td key={column.label} className={numeric(column) ? "pdk-num" : undefined}>
                        {c === 0 ? "Total" : value !== null ? formatValue(value, column.format) : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {pages > 1 ? (
          <div className="pdk-table-pager">
            <span>
              {safePage * pageSize + 1}–{Math.min(order.length, (safePage + 1) * pageSize)} of {order.length}
            </span>
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
            <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next</button>
          </div>
        ) : null}
      </div>
    );
  },
});

/* ---------- Heatmap: two categorical axes ---------- */

const heatmapSchema = z.object({
  rows: z.array(z.string()),
  columns: z.array(z.string()),
  values: z.array(numbersSchema),
  format: formatSchema.optional(),
  showValues: z.boolean().optional(),
});

export const Heatmap = defineComponent({
  name: "Heatmap",
  props: heatmapSchema,
  description:
    "Magnitude across two categories (weekday × hour); values[r][c], null for no data. showValues prints numbers in cells.",
  component: function HeatmapView({ props }: ComponentRenderProps<z.infer<typeof heatmapSchema>>) {
    const rowLabels = toStrings(props.rows);
    const columnLabels = toStrings(props.columns);
    const grid = (Array.isArray(props.values) ? props.values : []).map((row) => toNumbers(row));
    const cells = grid.flat().filter((value): value is number => value !== null);
    if (!rowLabels.length || !columnLabels.length || !cells.length) return <Empty />;
    const min = Math.min(...cells);
    const max = Math.max(...cells);
    return (
      <div className="pdk-cohort-wrap">
        <table className="pdk-cohort" style={{ borderSpacing: 2, tableLayout: "fixed" }}>
          {/* Fixed layout keeps every hour or day column the same width. */}
          <colgroup>
            <col style={{ width: 56 }} />
            {columnLabels.map((column) => (
              <col key={column} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {columnLabels.map((column) => (
                <th key={column} style={{ fontSize: 11 }}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((row, r) => (
              <tr key={row}>
                <td className="pdk-cohort-label" style={{ paddingRight: 8 }}>{row}</td>
                {columnLabels.map((column, c) => {
                  const value = grid[r]?.[c] ?? null;
                  if (value === null) return <td key={column} className="pdk-cohort-empty" />;
                  const { background, ink } = sequentialColor(value, min, max);
                  return (
                    <td
                      key={column}
                      className={`pdk-ink-${ink}`}
                      style={{ background, height: 26, minWidth: 26, fontSize: 11 }}
                      title={`${row}, ${column}: ${formatValue(value, props.format)}`}
                    >
                      {props.showValues ? formatValue(value, props.format, { axis: true }) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pdk-legend" style={{ marginTop: 10, alignItems: "center" }}>
          <span>{formatValue(min, props.format, { axis: true })}</span>
          <span style={{ display: "inline-flex", gap: 2 }}>
            {[0, 2, 4, 6, 8].map((step) => (
              <span key={step} style={{ width: 18, height: 8, borderRadius: 2, background: `var(--pdk-seq-${step + 1})` }} />
            ))}
          </span>
          <span>{formatValue(max, props.format, { axis: true })}</span>
        </div>
      </div>
    );
  },
});

/* ---------- Leaderboard ---------- */

const leaderboardSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
  format: formatSchema.optional(),
  previous: z.array(z.number()).optional(),
  goodWhen: goodWhenSchema.optional(),
  limit: z.number().optional(),
});

export const Leaderboard = defineComponent({
  name: "Leaderboard",
  props: leaderboardSchema,
  description:
    "Ranked list with inline bars and change vs previous: top channels, pages, campaigns.",
  component: function LeaderboardView({ props }: ComponentRenderProps<z.infer<typeof leaderboardSchema>>) {
    const labels = toStrings(props.labels);
    const values = toNumbers(props.values);
    const previous = toNumbers(props.previous);
    const items = labels
      .map((label, i) => ({ label, value: values[i] ?? 0, previous: previous[i] ?? null }))
      .sort((a, b) => b.value - a.value)
      .slice(0, props.limit ?? 8);
    if (!items.length) return <Empty />;
    const top = Math.max(...items.map((item) => item.value), 0);
    return (
      <ol className="pdk-rank">
        {items.map((item) => (
          <li key={item.label} className="pdk-rank-row">
            <div className="pdk-rank-top">
              <span className="pdk-rank-name" title={item.label}>{item.label}</span>
              <span className="pdk-rank-value">
                {formatValue(item.value, props.format)}
                <DeltaBadge current={item.value} previous={item.previous} format={props.format} goodWhen={props.goodWhen} inline />
              </span>
            </div>
            <div className="pdk-rank-track">
              <div className="pdk-rank-fill" style={{ width: `${top ? (item.value / top) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ol>
    );
  },
});

/* ---------- Goal ---------- */

const goalSchema = z.object({
  label: z.string(),
  value: z.number(),
  target: z.number(),
  format: formatSchema.optional(),
  pace: z.number().optional(),
  goodWhen: goodWhenSchema.optional(),
});

export const Goal = defineComponent({
  name: "Goal",
  props: goalSchema,
  description:
    "Progress toward a target. pace (0–1) is how far through the period we are; the bar marks ahead/behind pace. goodWhen \"down\" makes target a ceiling (churn ≤ 2%). Stack several in one Card.",
  component: function GoalView({ props }: ComponentRenderProps<z.infer<typeof goalSchema>>) {
    const noTarget = !(props.target > 0);
    const progress = noTarget ? (props.value > 0 ? 1 : 0) : props.value / props.target;
    const ceiling = props.goodWhen === "down";
    const pace = !ceiling && typeof props.pace === "number" ? Math.min(1, Math.max(0, props.pace)) : null;
    const state = ceiling ? (props.value <= props.target ? "ahead" : "over") : pace === null ? "neutral" : progress >= pace ? "ahead" : "behind";
    return (
      <div className="pdk-goal">
        <div className="pdk-goal-top">
          <span>{props.label}</span>
          <span>
            <strong>{formatValue(props.value, props.format)}</strong>
            <span style={{ color: "var(--pdk-ink-muted)" }}> / {formatValue(props.target, props.format)}</span>
          </span>
        </div>
        <div className="pdk-goal-track">
          <div className="pdk-goal-fill" data-state={state} style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          {pace !== null ? <span className="pdk-goal-pace" style={{ left: `${pace * 100}%` }} title="Expected by now" /> : null}
        </div>
        <div className="pdk-goal-foot">
          <span>{ceiling ? `Limit ${formatValue(props.target, props.format)}` : noTarget ? "No target set" : `${formatValue(progress * 100, "percent")} of target`}</span>
          {ceiling ? <span className={state === "over" ? "pdk-goal-over" : undefined}>{state === "ahead" ? "Within limit" : "Over limit"}</span> : pace !== null ? <span>{state === "ahead" ? "Ahead of pace" : "Behind pace"}</span> : null}
        </div>
      </div>
    );
  },
});

/* ---------- SegmentedBar ---------- */

const segmentedBarSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
  format: formatSchema.optional(),
});

export const SegmentedBar = defineComponent({
  name: "SegmentedBar",
  props: segmentedBarSchema,
  description:
    "Part of a whole as one bar with a legend of values and shares; up to 8 parts.",
  component: function SegmentedBarView({ props }: ComponentRenderProps<z.infer<typeof segmentedBarSchema>>) {
    const labels = toStrings(props.labels);
    const values = toNumbers(props.values).map((value) => value ?? 0);
    let parts = labels.map((label, i) => ({ label, value: values[i] ?? 0 })).filter((part) => part.value > 0);
    if (parts.length > 8) {
      const rest = parts.slice(7).reduce((sum, part) => sum + part.value, 0);
      parts = [...parts.slice(0, 7), { label: "Other", value: rest }];
    }
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    if (!total) return <Empty />;
    const color = (part: { label: string }, i: number) => (part.label === "Other" ? MUTED_COLOR : seriesColor(i));
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div className="pdk-segbar" role="img" aria-label={parts.map((part) => `${part.label} ${formatValue((part.value / total) * 100, "percent")}`).join(", ")}>
          {parts.map((part, i) => (
            <span key={part.label} style={{ width: `${(part.value / total) * 100}%`, background: color(part, i) }} title={part.label} />
          ))}
        </div>
        <div className="pdk-segbar-legend">
          {parts.map((part, i) => (
            <div key={part.label}>
              <span>
                <span className="pdk-legend-swatch" style={{ background: color(part, i) }} />
                {part.label}
              </span>
              <span>
                {formatValue(part.value, props.format)}{" "}
                {/* Values that are already shares would print the same number twice. */}
                {isRateFormat(props.format) ? null : (
                  <span style={{ color: "var(--pdk-ink-muted)", fontWeight: 400 }}>{formatValue((part.value / total) * 100, "percent")}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  },
});

/* ---------- KeyValues ---------- */

const keyValueSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  format: formatSchema.optional(),
  previous: z.number().nullable().optional(),
  goodWhen: goodWhenSchema.optional(),
});

const keyValuesSchema = z.object({
  rows: z.array(keyValueSchema),
});

export const KeyValues = defineComponent({
  name: "KeyValues",
  props: keyValuesSchema,
  description:
    "Label/value fact rows, e.g. [{label: \"Trials\", value: 572, format: \"number\", previous: 547}, {label: \"Owner\", value: \"Growth team\"}].",
  component: function KeyValuesView({ props }: ComponentRenderProps<z.infer<typeof keyValuesSchema>>) {
    const rows = Array.isArray(props.rows) ? props.rows.filter(Boolean) : [];
    if (!rows.length) return <Empty />;
    return (
      <dl className="pdk-kv">
        {rows.map((row) => (
          <div key={row.label} className="pdk-kv-row">
            <dt>{row.label}</dt>
            <dd>
              {typeof row.value === "number" ? formatValue(row.value, row.format) : row.value || "—"}
              {typeof row.value === "number" ? (
                <DeltaBadge current={row.value} previous={row.previous} format={row.format} goodWhen={row.goodWhen} inline />
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    );
  },
});

