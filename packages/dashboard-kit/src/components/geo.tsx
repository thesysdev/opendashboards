"use client";

import { defineComponent, type ComponentRenderProps } from "@openuidev/react-lang";
import { geoAlbersUsa, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { z } from "zod/v4";

import { formatSchema, formatValue } from "../format";
import { goodWhenSchema } from "../schema";
import { sequentialColor } from "../theme";
import { DeltaBadge, Empty, toNumbers, toStrings } from "./shared";

/* ---------- Region matching ---------- */

type Shape = Feature<Geometry, { name: string }>;

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/** Common names and ISO codes → the names used by world-atlas. */
const COUNTRY_ALIASES: Record<string, string> = {
  us: "United States of America", usa: "United States of America", unitedstates: "United States of America",
  uk: "United Kingdom", gb: "United Kingdom", gbr: "United Kingdom", greatbritain: "United Kingdom", england: "United Kingdom",
  de: "Germany", deu: "Germany", fr: "France", fra: "France", ca: "Canada", can: "Canada", au: "Australia", aus: "Australia",
  in: "India", ind: "India", br: "Brazil", bra: "Brazil", jp: "Japan", jpn: "Japan", cn: "China", chn: "China",
  es: "Spain", esp: "Spain", it: "Italy", ita: "Italy", nl: "Netherlands", nld: "Netherlands", holland: "Netherlands",
  se: "Sweden", swe: "Sweden", no: "Norway", nor: "Norway", dk: "Denmark", dnk: "Denmark", fi: "Finland", fin: "Finland",
  ie: "Ireland", irl: "Ireland", pl: "Poland", pol: "Poland", pt: "Portugal", prt: "Portugal", ch: "Switzerland", che: "Switzerland",
  at: "Austria", aut: "Austria", be: "Belgium", bel: "Belgium", mx: "Mexico", mex: "Mexico", ar: "Argentina", arg: "Argentina",
  co: "Colombia", col: "Colombia", cl: "Chile", chl: "Chile", za: "South Africa", zaf: "South Africa", ng: "Nigeria", nga: "Nigeria",
  eg: "Egypt", egy: "Egypt", ke: "Kenya", ken: "Kenya", sg: "Singapore", sgp: "Singapore", id: "Indonesia", idn: "Indonesia",
  ph: "Philippines", phl: "Philippines", vn: "Vietnam", vnm: "Vietnam", th: "Thailand", tha: "Thailand", my: "Malaysia", mys: "Malaysia",
  kr: "South Korea", kor: "South Korea", korea: "South Korea", southkorea: "South Korea", tw: "Taiwan", twn: "Taiwan",
  il: "Israel", isr: "Israel", tr: "Turkey", tur: "Turkey", turkiye: "Turkey", ae: "United Arab Emirates", are: "United Arab Emirates", uae: "United Arab Emirates",
  sa: "Saudi Arabia", sau: "Saudi Arabia", ru: "Russia", rus: "Russia", russianfederation: "Russia", ua: "Ukraine", ukr: "Ukraine",
  nz: "New Zealand", nzl: "New Zealand", cz: "Czechia", cze: "Czechia", czechrepublic: "Czechia", ro: "Romania", rou: "Romania",
  hu: "Hungary", hun: "Hungary", gr: "Greece", grc: "Greece", pk: "Pakistan", pak: "Pakistan", bd: "Bangladesh", bgd: "Bangladesh",
  pe: "Peru", per: "Peru",
};

const US_STATES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  dc: "District of Columbia", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah",
  vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

function shapeName(label: string, region: "world" | "us") {
  const key = normalize(label);
  if (region === "us") return US_STATES[key] ?? label;
  return COUNTRY_ALIASES[key] ?? label;
}

/* ---------- Shapes, loaded on first use ---------- */

const shapeCache: Partial<Record<"world" | "us", Promise<Shape[]>>> = {};

function loadShapes(region: "world" | "us"): Promise<Shape[]> {
  shapeCache[region] ??= (
    region === "us"
      ? import("us-atlas/states-10m.json").then((module) => {
          const topology = (module.default ?? module) as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>;
          return (feature(topology, topology.objects.states) as FeatureCollection<Geometry, { name: string }>).features;
        })
      : import("world-atlas/countries-110m.json").then((module) => {
          const topology = (module.default ?? module) as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
          return (feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name: string }>).features.filter(
            (shape) => shape.properties.name !== "Antarctica",
          );
        })
  ) as Promise<Shape[]>;
  return shapeCache[region]!;
}

/* ---------- GeoMap ---------- */

const geoMapSchema = z.object({
  region: z.enum(["world", "us"]),
  labels: z.array(z.string()),
  values: z.array(z.number()),
  format: formatSchema.optional(),
  previous: z.array(z.number()).optional(),
  goodWhen: goodWhenSchema.optional(),
  limit: z.number().optional(),
});

const WIDTH = 760;

export const GeoMap = defineComponent({
  name: "GeoMap",
  props: geoMapSchema,
  description:
    "Choropleth with a ranked list. region \"world\" takes country names or ISO codes (\"DE\", \"GBR\"); \"us\" takes state names or codes (\"NY\"). Use width \"two-thirds\" or \"full\".",
  component: function GeoMapView({ props }: ComponentRenderProps<z.infer<typeof geoMapSchema>>) {
    const region = props.region === "us" ? "us" : "world";
    const [shapes, setShapes] = useState<Shape[] | null>(null);
    const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

    useEffect(() => {
      let live = true;
      loadShapes(region).then((loaded) => live && setShapes(loaded));
      return () => {
        live = false;
      };
    }, [region]);

    const labels = toStrings(props.labels);
    const values = toNumbers(props.values);
    const previous = toNumbers(props.previous);
    const byName = useMemo(() => {
      const map = new Map<string, { label: string; value: number; previous: number | null }>();
      labels.forEach((label, i) => {
        const value = values[i];
        if (typeof value === "number") map.set(normalize(shapeName(label, region)), { label, value, previous: previous[i] ?? null });
      });
      return map;
    }, [labels, values, previous, region]);

    const height = region === "us" ? 440 : 380;
    const paths = useMemo(() => {
      if (!shapes) return [];
      const collection = { type: "FeatureCollection", features: shapes } as FeatureCollection<Geometry, { name: string }>;
      const projection = (region === "us" ? geoAlbersUsa() : geoNaturalEarth1()).fitSize([WIDTH, height], collection);
      const path = geoPath(projection);
      return shapes.map((shape) => ({ name: shape.properties.name, d: path(shape) ?? "" }));
    }, [shapes, region, height]);

    const mapped = new Set(paths.map((shape) => normalize(shape.name)));
    if (!labels.length) return <Empty />;
    const known = [...byName.values()];
    const min = Math.min(...known.map((entry) => entry.value));
    const max = Math.max(...known.map((entry) => entry.value));
    const ranked = [...known].sort((a, b) => b.value - a.value).slice(0, props.limit ?? 8);
    const hovered = hover ? byName.get(normalize(hover.name)) : undefined;

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ position: "relative", flex: "2 1 340px", minWidth: 0 }} onMouseLeave={() => setHover(null)}>
          {shapes ? (
            <svg viewBox={`0 0 ${WIDTH} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Map">
              {paths.map((shape) => {
                const entry = byName.get(normalize(shape.name));
                const fill = entry ? sequentialColor(entry.value, min, max).background : "var(--pdk-map-land)";
                return (
                  <path
                    key={shape.name}
                    d={shape.d}
                    fill={fill}
                    stroke="var(--pdk-surface)"
                    strokeWidth={0.75}
                    style={{ transition: "opacity 120ms", opacity: hover && hover.name !== shape.name ? 0.75 : 1 }}
                    onMouseMove={(event) => {
                      const box = (event.currentTarget.ownerSVGElement?.parentElement ?? event.currentTarget).getBoundingClientRect();
                      setHover({ name: shape.name, x: event.clientX - box.left, y: event.clientY - box.top });
                    }}
                  />
                );
              })}
            </svg>
          ) : (
            <div className="pdk-empty" style={{ height: 280 }}>Loading map…</div>
          )}
          {hover ? (
            <div className="pdk-tooltip" style={{ position: "absolute", left: hover.x + 12, top: hover.y + 12, pointerEvents: "none", minWidth: 140 }}>
              <div className="pdk-tooltip-title">{hovered?.label ?? hover.name}</div>
              <div className="pdk-tooltip-row">
                <span>Value</span>
                <span className="pdk-tooltip-value">
                  {hovered ? formatValue(hovered.value, props.format) : "No data"}{" "}
                  {hovered ? <DeltaBadge current={hovered.value} previous={hovered.previous} format={props.format} goodWhen={props.goodWhen} inline /> : null}
                </span>
              </div>
            </div>
          ) : null}
          <div className="pdk-legend" style={{ marginTop: 8, alignItems: "center" }}>
            <span>{formatValue(min, props.format, { axis: true })}</span>
            <span style={{ display: "inline-flex", gap: 2 }}>
              {[0, 2, 4, 6, 8].map((step) => (
                <span key={step} style={{ width: 18, height: 8, borderRadius: 2, background: `var(--pdk-seq-${step + 1})` }} />
              ))}
            </span>
            <span>{formatValue(max, props.format, { axis: true })}</span>
          </div>
        </div>
        <ol className="pdk-rank" style={{ flex: "1 1 200px" }}>
          {ranked.map((entry) => (
            <li key={entry.label} className="pdk-rank-row">
              <div className="pdk-rank-top">
                <span className="pdk-rank-name" title={entry.label}>
                  {entry.label}
                  {shapes && !mapped.has(normalize(shapeName(entry.label, region))) ? (
                    <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11.5, color: "var(--pdk-ink-muted)" }}>not on map</span>
                  ) : null}
                </span>
                <span className="pdk-rank-value">
                  {formatValue(entry.value, props.format)}
                  <DeltaBadge current={entry.value} previous={entry.previous} format={props.format} goodWhen={props.goodWhen} inline />
                </span>
              </div>
              <div className="pdk-rank-track">
                <div className="pdk-rank-fill" style={{ width: `${max ? (entry.value / max) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  },
});
