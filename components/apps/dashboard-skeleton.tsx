"use client";

import { cn } from "@/lib/utils";
import { useEffect, useId, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

// The dashboard area before there's a dashboard: a dotted sketch of a dashboard, drawn widget by
// widget. Each widget's outline is traced in small round dots, then its insides fade in, then the
// next widget starts; once all are drawn the sketch holds, fades, and draws again. Nothing else
// moves: no field, no guides, no shimmer.
//
// Nobody knows yet what the build will make, so it's a generic dashboard, two layouts in turn. It's
// laid out like the real one (same insets, a grid that stacks when the area is narrow) and drawn
// in SVG at 100% of each box, so it follows the area as it resizes, mid-drawing too. With reduced
// motion it's the finished sketch, still. The animation itself is CSS (globals.css: .sketch-*).

/** When the first widget starts, and how far apart widgets start (ms). */
const FIRST_MS = 300;
const STEP_MS = 1100;
/** A widget's insides start this long after its outline does. */
const INSIDE_MS = 1000;
/** One sketch, from the first dot to the start of its fade; then the fade and a breath. */
const CYCLE_MS = 12_000;
const FADE_MS = 900;
const GAP_MS = 400;

const reducedQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (change) => {
      const media = window.matchMedia(reducedQuery);
      media.addEventListener("change", change);
      return () => media.removeEventListener("change", change);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

/** When widget `i` starts. */
const at = (i: number) => FIRST_MS + i * STEP_MS;
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * A dotted outline at the box's size. Traced, its dots are drawn on around the box, starting
 * top left; otherwise the whole outline fades in.
 */
function DotBox({
  className,
  style,
  radius = 14,
  start,
  trace = false,
}: {
  className?: string;
  style?: CSSProperties;
  radius?: number;
  start: number;
  trace?: boolean;
}) {
  const id = `sketch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className={cn("relative", !trace && "sketch-in", className)} style={{ ...style, ...(trace ? null : delay(start)) }}>
      <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
        {trace && (
          <defs>
            <mask id={id} x="-10%" y="-10%" width="120%" height="120%">
              {/* A wide white stroke drawn on along the same path uncovers the dots under it. */}
              <rect
                className="sketch-trace"
                style={delay(start)}
                width="100%"
                height="100%"
                rx={radius}
                pathLength={1}
                strokeDasharray="1 2"
                fill="none"
                stroke="#fff"
                strokeWidth={8}
              />
            </mask>
          </defs>
        )}
        <rect
          width="100%"
          height="100%"
          rx={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="0 5"
          strokeLinecap="round"
          mask={trace ? `url(#${id})` : undefined}
        />
      </svg>
    </div>
  );
}

/** A dotted line where text will be. */
function DotLine({ className, start }: { className?: string; start: number }) {
  return <span className={cn("sketch-in dot-line block h-[3px] max-w-full", className)} style={delay(start)} />;
}

/** One widget: its outline traced at `i`'s turn, `children` (its insides) after it. */
function Widget({ i, className, children }: { i: number; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("relative", className)}>
      <DotBox trace start={at(i)} className="absolute inset-0" />
      <div className="relative flex h-full flex-col gap-4 p-5 text-black/[0.2]">{children}</div>
    </div>
  );
}

/** The filters most dashboards open with, traced together first. */
function Filters({ i, pills }: { i: number; pills: number }) {
  return (
    <div className="flex h-8 items-center gap-2">
      {Array.from({ length: pills }, (_, n) => (
        <DotBox
          key={n}
          trace
          start={at(i)}
          // Half the 32px height: SVG clamps a bigger corner to half of each side, which draws an ellipse.
          radius={16}
          className={cn("h-8 w-32 min-w-0", n === pills - 1 && "ml-auto hidden w-40 @min-[640px]:block")}
        />
      ))}
    </div>
  );
}

function Kpis({ i, cells }: { i: number; cells: 3 | 4 }) {
  const inside = at(i) + INSIDE_MS;
  return (
    <Widget i={i} className="h-[112px]">
      <div className={cn("grid h-full grid-cols-2 gap-6", cells === 4 ? "@min-[640px]:grid-cols-4" : "@min-[640px]:grid-cols-3")}>
        {Array.from({ length: cells }, (_, n) => (
          <div key={n} className={cn("min-w-0 flex-col justify-center gap-3", n > 1 ? "hidden @min-[640px]:flex" : "flex")}>
            <DotLine start={inside + n * 60} className="w-16" />
            <DotLine start={inside + n * 60 + 120} className="w-28 text-black/[0.3]" />
            <DotLine start={inside + n * 60 + 240} className="w-10" />
          </div>
        ))}
      </div>
    </Widget>
  );
}

function Columns({ i, heights, className }: { i: number; heights: number[]; className?: string }) {
  const inside = at(i) + INSIDE_MS;
  return (
    <Widget i={i} className={cn("h-[300px]", className)}>
      <DotLine start={inside} className="w-32" />
      <div className="flex min-h-0 flex-1 items-end gap-[5%] px-1">
        {heights.map((h, n) => (
          <DotBox key={n} start={inside + 80 + n * 50} radius={6} className="flex-1" style={{ height: `${h}%` }} />
        ))}
      </div>
      <DotLine start={inside + 80} className="w-full" />
    </Widget>
  );
}

function Bars({ i, widths, className }: { i: number; widths: number[]; className?: string }) {
  const inside = at(i) + INSIDE_MS;
  return (
    <Widget i={i} className={cn("h-[300px]", className)}>
      <DotLine start={inside} className="w-24" />
      <div className="flex flex-1 flex-col justify-center gap-5">
        {widths.map((w, n) => (
          <div key={n} className="flex items-center gap-3">
            <DotLine start={inside + 80 + n * 60} className="w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <DotBox start={inside + 120 + n * 60} radius={4} className="h-3" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function Donut({ i, className }: { i: number; className?: string }) {
  const inside = at(i) + INSIDE_MS;
  return (
    <Widget i={i} className={cn("h-[260px]", className)}>
      <DotLine start={inside} className="w-28" />
      <div className="flex min-w-0 flex-1 items-center gap-6">
        <DotBox start={inside + 80} radius={999} className="aspect-square w-32 max-w-[40%] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {[0, 1, 2, 3].map((n) => (
            <DotLine key={n} start={inside + 160 + n * 60} className="w-20" />
          ))}
        </div>
      </div>
    </Widget>
  );
}

function Table({ i, rows, className }: { i: number; rows: number; className?: string }) {
  const inside = at(i) + INSIDE_MS;
  return (
    <Widget i={i} className={className}>
      <DotLine start={inside} className="w-32" />
      <div className="flex flex-col gap-5 pt-1 pb-1">
        {Array.from({ length: rows }, (_, n) => (
          <div key={n} className="flex items-center justify-between gap-6">
            <DotLine start={inside + 80 + n * 60} className="w-1/3" />
            <DotLine start={inside + 80 + n * 60} className="w-1/6" />
            <DotLine start={inside + 80 + n * 60} className="w-1/12" />
          </div>
        ))}
      </div>
    </Widget>
  );
}

// Grid rows: one column when the area is narrow, five when it's wide.
const row = "grid grid-cols-1 gap-4 @min-[640px]:grid-cols-5";
const span2 = "@min-[640px]:col-span-2";
const span3 = "@min-[640px]:col-span-3";

// Generic dashboards, drawn in turn. Each runs past the bottom of the area, as a dashboard would.
const LAYOUTS: (() => ReactNode)[] = [
  () => (
    <>
      <Filters i={0} pills={3} />
      <Kpis i={1} cells={4} />
      <div className={row}>
        <Columns i={2} heights={[42, 66, 50, 82, 60, 94, 70, 54]} className={span3} />
        <Bars i={3} widths={[88, 64, 52, 38]} className={span2} />
      </div>
      <Table i={4} rows={4} />
      <div className={row}>
        <Donut i={5} className={span2} />
        <Columns i={5} heights={[58, 72, 46, 80, 66, 52]} className={span3} />
      </div>
    </>
  ),
  () => (
    <>
      <Filters i={0} pills={3} />
      <Kpis i={1} cells={3} />
      <Columns i={2} heights={[36, 44, 40, 52, 48, 60, 56, 66, 62, 74, 70, 82]} />
      <div className={row}>
        <Bars i={3} widths={[82, 70, 46, 30]} className={span2} />
        <Table i={4} rows={4} className={span3} />
      </div>
      <div className={row}>
        <Columns i={5} heights={[52, 60, 44, 70, 64, 78]} className={span3} />
        <Donut i={5} className={span2} />
      </div>
    </>
  ),
];

export function DashboardSkeleton({ className, still = false }: { className?: string; still?: boolean }) {
  const reduced = useReducedMotion();
  const moving = !still && !reduced;
  const [cycle, setCycle] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!moving) return;
    const fade = window.setTimeout(() => setLeaving(true), CYCLE_MS);
    const next = window.setTimeout(() => {
      setLeaving(false);
      setCycle((n) => n + 1);
    }, CYCLE_MS + FADE_MS + GAP_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(next);
    };
  }, [moving, cycle]);

  const Layout = LAYOUTS[cycle % LAYOUTS.length];
  return (
    <div aria-hidden className={cn("@container relative h-full overflow-hidden", className)}>
      <div
        // A new key draws the next sketch from its first dot.
        key={cycle}
        // Where the dashboard's own content will be: under the title, with the dashboard's 36px
        // (16px below 721px) sides and 24px top, up to its 1440px width.
        className={cn(
          "pointer-events-none absolute inset-x-4 top-5 mx-auto flex max-w-[1368px] flex-col gap-4 text-black/[0.28] transition-opacity ease-out select-none @min-[721px]:inset-x-9 @min-[721px]:top-6",
          (leaving || still) && "opacity-0",
        )}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        <Layout />
      </div>
    </div>
  );
}
