"use client";

import {
  defineComponent,
  reactive,
  useIsStreaming,
  useStateField,
  type ComponentRenderProps,
} from "@openuidev/react-lang";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { z } from "zod/v4";

import { useCompare } from "./shared";

const optionSchema = z.object({ value: z.string(), label: z.string().optional() });
type Option = z.infer<typeof optionSchema>;

function options(list: unknown): Option[] {
  if (!Array.isArray(list)) return [];
  return list.filter((option): option is Option => !!option && typeof option.value === "string");
}

/* ---------- PeriodPicker: the quick date-range filter ---------- */

const periodPickerSchema = z.object({
  name: z.string(),
  options: z.array(optionSchema),
  value: reactive(z.string().optional()),
});

export const PeriodPicker = defineComponent({
  name: "PeriodPicker",
  props: periodPickerSchema,
  description:
    "Segmented control for a few date presets, e.g. [{value: \"7d\", label: \"7D\"}, {value: \"30d\", label: \"30D\"}]. Use with static data keyed by preset.",
  component: function PeriodPickerView({ props }: ComponentRenderProps<z.infer<typeof periodPickerSchema>>) {
    const streaming = useIsStreaming();
    const field = useStateField(props.name, props.value);
    const list = options(props.options);
    const current = (field.value as string | undefined) ?? list[0]?.value;
    return (
      <div className="pdk-segmented" role="group" aria-label="Date range">
        {list.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === current}
            disabled={streaming}
            onClick={() => field.setValue(option.value)}
          >
            {option.label ?? option.value}
          </button>
        ))}
      </div>
    );
  },
});

/* ---------- ChipFilter: quick filters as pills ---------- */

const chipFilterSchema = z.object({
  name: z.string(),
  options: z.array(optionSchema),
  value: reactive(z.string().optional()),
  label: z.string().optional(),
});

export const ChipFilter = defineComponent({
  name: "ChipFilter",
  props: chipFilterSchema,
  description:
    "Pills for 2–6 segments; one is always selected.",
  component: function ChipFilterView({ props }: ComponentRenderProps<z.infer<typeof chipFilterSchema>>) {
    const streaming = useIsStreaming();
    const field = useStateField(props.name, props.value);
    const list = options(props.options);
    const current = (field.value as string | undefined) ?? list[0]?.value;
    return (
      <div className="pdk-chips" role="group" aria-label={props.label ?? props.name}>
        {props.label ? <span className="pdk-filter-label">{props.label}</span> : null}
        {list.map((option) => (
          <button
            key={option.value}
            type="button"
            className="pdk-chip"
            aria-pressed={option.value === current}
            disabled={streaming}
            onClick={() => field.setValue(option.value)}
          >
            {option.label ?? option.value}
          </button>
        ))}
      </div>
    );
  },
});

/* ---------- SelectFilter: a dropdown for longer lists ---------- */

const selectFilterSchema = z.object({
  name: z.string(),
  label: z.string(),
  options: z.array(optionSchema),
  value: reactive(z.string().optional()),
});

export const SelectFilter = defineComponent({
  name: "SelectFilter",
  props: selectFilterSchema,
  description:
    "Dropdown for one value out of a longer list.",
  component: function SelectFilterView({ props }: ComponentRenderProps<z.infer<typeof selectFilterSchema>>) {
    const streaming = useIsStreaming();
    const field = useStateField(props.name, props.value);
    const list = options(props.options);
    const current = (field.value as string | undefined) ?? list[0]?.value ?? "";
    return (
      <label className="pdk-select">
        <select
          aria-label={props.label}
          value={current}
          disabled={streaming}
          onChange={(event) => field.setValue(event.target.value)}
        >
          {list.map((option) => (
            <option key={option.value} value={option.value}>
              {props.label}: {option.label ?? option.value}
            </option>
          ))}
        </select>
      </label>
    );
  },
});

/* ---------- Shared popover for richer filters ---------- */

function Popover({ label, active, children, width = 280 }: { label: ReactNode; active?: boolean; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    // Capture phase: hosts often stop keyboard events from bubbling to the document.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div className="pdk-popover-anchor" ref={ref}>
      <button
        ref={trigger}
        type="button"
        className="pdk-filter-button"
        data-active={active ? "true" : undefined}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <span className="pdk-filter-caret" aria-hidden />
      </button>
      {open ? (
        <div className="pdk-popover" id={id} role="dialog" style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- DateRangeFilter: presets plus a custom range ---------- */

const DEFAULT_PRESETS: Option[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "ytd", label: "Year to date" },
];

const dateRangeSchema = z.object({
  name: z.string(),
  value: reactive(z.string().optional()),
  presets: z.array(optionSchema).optional(),
  label: z.string().optional(),
});

const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

function formatRange(value: string): string | null {
  const match = RANGE.exec(value);
  if (!match) return null;
  const [from, to] = [match[1], match[2]].map((day) => new Date(`${day}T00:00:00Z`));
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
  return `${day(from, !sameYear)} – ${day(to, true)}`;
}

export const DateRangeFilter = defineComponent({
  name: "DateRangeFilter",
  props: dateRangeSchema,
  description:
    "Dropdown with presets (default 7d, 30d, 90d, 12m, ytd) and a custom range. The value is a preset key or \"2026-10-01..2026-10-31\"; pass it to Query arguments.",
  component: function DateRangeFilterView({ props }: ComponentRenderProps<z.infer<typeof dateRangeSchema>>) {
    const field = useStateField(props.name, props.value);
    const presets = options(props.presets).length ? options(props.presets) : DEFAULT_PRESETS;
    const current = (field.value as string | undefined) ?? presets[1]?.value ?? presets[0]?.value ?? "";
    const custom = RANGE.exec(current);
    const [from, setFrom] = useState(custom?.[1] ?? "");
    const [to, setTo] = useState(custom?.[2] ?? "");
    // State can arrive after mount (and change from outside): keep the inputs on the current range.
    const customFrom = custom?.[1];
    const customTo = custom?.[2];
    useEffect(() => {
      if (customFrom && customTo) {
        setFrom(customFrom);
        setTo(customTo);
      }
    }, [customFrom, customTo]);
    const text = presets.find((preset) => preset.value === current)?.label ?? formatRange(current) ?? current;
    const valid = from && to && from <= to;
    return (
      <Popover
        width={320}
        label={
          <>
            <span className="pdk-calendar" aria-hidden />
            {props.label ? <span className="pdk-select-prefix">{props.label}:</span> : null}
            {text}
          </>
        }
      >
        {(close) => (
          <div className="pdk-range">
            <div className="pdk-range-presets" role="listbox" aria-label="Presets">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  role="option"
                  aria-selected={preset.value === current}
                  onClick={() => {
                    field.setValue(preset.value);
                    close();
                  }}
                >
                  {preset.label ?? preset.value}
                </button>
              ))}
            </div>
            <div className="pdk-range-custom">
              <span className="pdk-filter-label">Custom range</span>
              <label>
                From
                <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
              </label>
              <button
                type="button"
                className="pdk-button-primary"
                disabled={!valid}
                onClick={() => {
                  field.setValue(`${from}..${to}`);
                  close();
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </Popover>
    );
  },
});

/* ---------- MultiSelectFilter: pick several values ---------- */

const multiSelectSchema = z.object({
  name: z.string(),
  label: z.string(),
  options: z.array(optionSchema),
  value: reactive(z.array(z.string()).optional()),
});

export const MultiSelectFilter = defineComponent({
  name: "MultiSelectFilter",
  props: multiSelectSchema,
  description:
    "Dropdown with checkboxes; the value is an array of selected values ([] means all). Pass it to Query arguments.",
  component: function MultiSelectFilterView({ props }: ComponentRenderProps<z.infer<typeof multiSelectSchema>>) {
    const field = useStateField(props.name, props.value);
    const list = options(props.options);
    const selected = Array.isArray(field.value) ? (field.value as string[]) : [];
    const names = list.filter((option) => selected.includes(option.value)).map((option) => option.label ?? option.value);
    const summary = !names.length || names.length === list.length ? "All" : names.length <= 2 ? names.join(", ") : `${names.length} selected`;
    const toggle = (value: string) =>
      field.setValue(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
    return (
      <Popover
        active={names.length > 0 && names.length < list.length}
        label={
          <>
            <span className="pdk-select-prefix">{props.label}:</span>
            {summary}
          </>
        }
      >
        {() => (
          <div className="pdk-multi">
            <div className="pdk-multi-list">
              {list.map((option) => (
                <label key={option.value} className="pdk-multi-option">
                  <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
                  {option.label ?? option.value}
                </label>
              ))}
            </div>
            <div className="pdk-multi-foot">
              <button type="button" onClick={() => field.setValue(list.map((option) => option.value))}>
                Select all
              </button>
              <button type="button" onClick={() => field.setValue([])}>
                Clear
              </button>
            </div>
          </div>
        )}
      </Popover>
    );
  },
});

/* ---------- SearchFilter: free-text search ---------- */

const searchFilterSchema = z.object({
  name: z.string(),
  placeholder: z.string().optional(),
  value: reactive(z.string().optional()),
});

export const SearchFilter = defineComponent({
  name: "SearchFilter",
  props: searchFilterSchema,
  description:
    "Search box. Pass its $variable to Table(..., search) or to Query arguments.",
  component: function SearchFilterView({ props }: ComponentRenderProps<z.infer<typeof searchFilterSchema>>) {
    const field = useStateField(props.name, props.value);
    const value = (field.value as string | undefined) ?? "";
    return (
      <label className="pdk-search">
        <span className="pdk-search-icon" aria-hidden />
        <input
          type="search"
          value={value}
          placeholder={props.placeholder ?? "Search"}
          aria-label={props.placeholder ?? "Search"}
          onChange={(event) => field.setValue(event.target.value)}
        />
      </label>
    );
  },
});

/* ---------- CompareToggle: previous-period overlays ---------- */

const compareToggleSchema = z.object({
  label: z.string().optional(),
  defaultOn: z.boolean().optional(),
});

export const CompareToggle = defineComponent({
  name: "CompareToggle",
  props: compareToggleSchema,
  description:
    "Overlays the previous period on every chart that has previous data (dashed lines, ghost bars, funnel markers). label names the comparison (\"Previous period\", \"Same period last year\").",
  component: function CompareToggleView({ props }: ComponentRenderProps<z.infer<typeof compareToggleSchema>>) {
    const compare = useCompare();
    const label = props.label || "Previous period";
    const { setLabel, setEnabled } = compare;
    useEffect(() => setLabel(label), [label, setLabel]);
    useEffect(() => {
      if (props.defaultOn) setEnabled(true);
    }, [props.defaultOn, setEnabled]);
    return (
      <button
        type="button"
        className="pdk-toggle"
        aria-pressed={compare.enabled}
        onClick={() => compare.setEnabled(!compare.enabled)}
      >
        <span className="pdk-toggle-track" aria-hidden />
        Compare: {label.toLowerCase()}
      </button>
    );
  },
});

/* ---------- FilterBar ---------- */

const filterBarSchema = z.object({
  filters: z.array(
    z.union([PeriodPicker.ref, DateRangeFilter.ref, ChipFilter.ref, SelectFilter.ref, MultiSelectFilter.ref, SearchFilter.ref, CompareToggle.ref]),
  ),
});

export const FilterBar = defineComponent({
  name: "FilterBar",
  props: filterBarSchema,
  description:
    "Sticky row of dashboard-wide filters, right after the header.",
  component: function FilterBarView({ props, renderNode }: ComponentRenderProps<z.infer<typeof filterBarSchema>>) {
    const filters = Array.isArray(props.filters) ? props.filters : [];
    const toggles = filters.filter((node) => (node as { typeName?: string })?.typeName === "CompareToggle");
    const others = filters.filter((node) => (node as { typeName?: string })?.typeName !== "CompareToggle");
    return (
      <div className="pdk-filterbar" role="toolbar" aria-label="Filters">
        {renderNode(others)}
        <span className="pdk-filterbar-spacer" />
        {renderNode(toggles)}
      </div>
    );
  },
});
