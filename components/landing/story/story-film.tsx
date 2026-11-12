"use client";

import { ArrowUp, Check, CreditCard, MousePointerClick, Users, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";

import { BrandMark } from "../brand-mark";
import { BRANDS, type Brand } from "../brands";
import { blurIn, blurSwap, camAt, lerp, ramp, type CamKey } from "./motion";

/*
 * The story film: a question is asked, the data it needs flies out of the
 * sentence, each piece is fetched from the tool that has it (PostHog, your
 * database, Stripe), and the dashboard streams in and keeps refreshing. Every
 * frame is a pure function of T. World units are px in a 1200×600 viewport.
 */

export const FILM_STEPS = [
  { id: "ask", start: 0, length: 3.3 },
  { id: "fetch", start: 3.3, length: 4.3 },
  { id: "build", start: 7.6, length: 2.8 },
  { id: "live", start: 10.4, length: 5.6 },
] as const;
export const FILM_LENGTH = 16;
/** The moment reduced motion rests on: every need fetched. */
export const FILM_STILL = 6.9;
const RESET = 15.7;

const INPUT = { x: 600, y: 300, w: 760, h: 76, pad: 32 };
const QUERY_SIZE = 22;
const PROMPT_Y = 300;
const PROMPT_SCALE = 1.25;
const LIST = { x: 170, y: 196, w: 260, h: 208, label: 228 };
const LABEL_SIZE = 16;
const FLY_SCALE = (QUERY_SIZE * PROMPT_SCALE) / LABEL_SIZE;
/** One tile per tool on the right, each level with the need it answers. */
const SRC = { x: 770, w: 260, h: 56 };
const DASH = { x: 100, y: 750, w: 1000, h: 700 };
const BUILD_AT = 8.0;
const REFRESH_AT = 12.2;
/** "Always current": the notch drops in and the dashboard refreshes, then the new numbers land at REFRESH_AT and the notch confirms and lifts away. */
const UPDATING_AT = 10.9;
const NOTCH_OUT: [number, number] = [13.6, 14.0];
const VIEW = { cx: 600, cy: DASH.y + DASH.h / 2, s: 0.78 };
const PUSH = { cx: 600, cy: DASH.y + 230, s: 1.15 };

const X0 = LIST.x + LIST.w;
const X1 = SRC.x;
const XM = (X0 + X1) / 2;

type Need = "source" | "customers" | "revenue";
type NeedSpec = {
  id: Need;
  label: string;
  icon: LucideIcon;
  y: number;
  /** What runs against the tool, on the rail. */
  call: string;
  tool: { brand: Brand; meta: string };
  lit: number;
  fly: number;
  draw: number;
};

const NEEDS: NeedSpec[] = [
  {
    id: "source",
    label: "Signup source",
    icon: MousePointerClick,
    y: 236,
    call: "events.source",
    tool: { brand: BRANDS.posthog, meta: "product analytics" },
    lit: 2.6,
    fly: 3.3,
    draw: 4.5,
  },
  {
    id: "customers",
    label: "Paying customers",
    icon: Users,
    y: 300,
    call: "SELECT customers",
    tool: { brand: BRANDS.postgres, meta: "database" },
    lit: 2.72,
    fly: 3.38,
    draw: 5.2,
  },
  {
    id: "revenue",
    label: "Revenue",
    icon: CreditCard,
    y: 364,
    call: "GET /charges",
    tool: { brand: BRANDS.stripe, meta: "payments" },
    lit: 2.84,
    fly: 3.46,
    draw: 5.9,
  },
];

const WORDS: { text: string; need?: Need }[] = [
  { text: "Rank" },
  { text: "signup sources", need: "source" },
  { text: "by" },
  { text: "paying customers", need: "customers" },
  { text: "and" },
  { text: "revenue", need: "revenue" },
];

const SEND_AT = 1.55;
const MORPH: [number, number] = [1.75, 2.45];
const FLY_LENGTH = 0.85;
const OK_AFTER = 0.85;

type Status = "loading" | "ok";
const statusAt = (n: NeedSpec, tc: number): Status | undefined =>
  tc < n.draw ? undefined : tc >= n.draw + OK_AFTER ? "ok" : "loading";

type Anchors = { width: number; height: number; left: Partial<Record<Need, number>> };

/** Hairlines and shadows shared by the film's surfaces. */
const EDGE = "border border-[rgb(10_10_11/0.08)]";
/** A highlighted need, in the question and on its way to the list. */
const LIT = "data-lit:bg-[rgb(47_91_255/0.1)] data-lit:text-[#2f5bff]";

const phone = "(max-width: 767px)";
const watchPhone = (cb: () => void) => {
  const m = window.matchMedia(phone);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** True on phone widths, where the film shows its central 900px and zooms in less. */
function useNarrow() {
  return useSyncExternalStore(
    watchPhone,
    () => window.matchMedia(phone).matches,
    () => false,
  );
}

function Query({ tc, anchors, onMeasure }: { tc: number; anchors: Anchors | null; onMeasure: (a: Anchors) => void }) {
  const m = ramp(tc, MORPH[0], MORPH[1]);
  const W = anchors?.width ?? 520;
  const H = anchors?.height ?? 30;
  const x = lerp(INPUT.x - INPUT.w / 2 + INPUT.pad + W / 2, 600, m);
  const y = lerp(INPUT.y, PROMPT_Y, m);
  const rest = ramp(tc, 3.3, 3.75);
  const press = ramp(tc, SEND_AT - 0.08, SEND_AT) * (1 - ramp(tc, SEND_AT + 0.05, SEND_AT + 0.2));
  // Where each need's words sit in the sentence, so they fly out from there.
  const measure = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node) return;
      const read = () => {
        const left: Anchors["left"] = {};
        node.querySelectorAll<HTMLElement>("[data-need]").forEach((el) => {
          left[el.dataset.need as Need] = el.offsetLeft + 2;
        });
        onMeasure({ width: node.offsetWidth, height: node.offsetHeight, left });
      };
      read();
      document.fonts?.ready.then(read);
    },
    [onMeasure],
  );
  if (rest >= 1) return null;
  return (
    <>
      {m < 1 ? (
        // The input: a wide pill with one round button. It fades away and leaves the question behind.
        <div
          className={`flex items-center justify-end rounded-full bg-white px-3.5 shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_20px_-10px_rgb(16_24_40/0.22)] [transform:translate(-50%,-50%)] ${EDGE}`}
          style={{
            left: INPUT.x,
            top: INPUT.y,
            width: INPUT.w,
            height: INPUT.h,
            ...(m > 0 ? { opacity: 1 - m, filter: `blur(${(m * 6).toFixed(2)}px)` } : blurIn(tc, 0.1, 0.55, 12)),
          }}
        >
          <span
            data-ready={tc > 1.25 || undefined}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#e5e5ea] text-white data-ready:bg-[#0a0a0b]"
            style={{ scale: `${1 - press * 0.12}` }}
          >
            <ArrowUp className="size-5" />
          </span>
        </div>
      ) : null}
      <span
        ref={measure}
        className="flex origin-center gap-[0.36em] text-[22px] leading-[30px] font-medium tracking-[-0.015em] whitespace-nowrap"
        style={{
          left: x - W / 2,
          top: y - H / 2,
          scale: `${lerp(1, PROMPT_SCALE, m)}`,
          ...(rest > 0 ? { opacity: 1 - rest, filter: `blur(${(rest * 6).toFixed(2)}px)` } : null),
        }}
      >
        {WORDS.map((word, i) => {
          const need = NEEDS.find((n) => n.id === word.need);
          return (
            <span
              key={word.text}
              data-need={word.need}
              data-lit={(need && tc >= need.lit) || undefined}
              className={`relative -mx-0.5 inline-block rounded-md px-0.5 transition-[background-color,color] duration-300 motion-reduce:transition-none ${LIT}`}
              style={need && tc >= need.fly ? { opacity: 0 } : blurIn(tc, 0.45 + i * 0.08, 0.5, 8)}
            >
              {word.text}
            </span>
          );
        })}
      </span>
    </>
  );
}

/** A need's words leave the sentence and become the title of its row. */
function Label({ need, tc, anchors }: { need: NeedSpec; tc: number; anchors: Anchors | null }) {
  if (tc < need.fly) return null;
  const f = ramp(tc, need.fly, need.fly + FLY_LENGTH);
  const W = anchors?.width ?? 520;
  const from = 600 + ((anchors?.left[need.id] ?? W / 2) - W / 2) * PROMPT_SCALE;
  const swap = blurSwap(tc, need.fly + 0.2, 0.45);
  const word = WORDS.find((w) => w.need === need.id)!.text;
  return (
    <span
      data-lit={f < 0.6 || undefined}
      className={`-ml-0.5 origin-[2px_50%] rounded-md px-0.5 text-base leading-5 font-medium tracking-[-0.015em] whitespace-nowrap transition-[background-color,color] duration-250 motion-reduce:transition-none ${LIT}`}
      style={{
        left: lerp(from, LIST.label, f),
        top: lerp(PROMPT_Y, need.y, f) - 10,
        scale: `${lerp(FLY_SCALE, 1, f)}`,
        ...swap.style,
      }}
    >
      {swap.showNew ? need.label : word}
    </span>
  );
}

function Spinner() {
  return (
    <i className="size-[13px] animate-spin rounded-full border-[1.5px] border-[#d2d2d7] border-t-[#2f5bff] [animation-duration:0.8s] motion-reduce:animate-none" />
  );
}

/** Chevron rails between each need and its tool. */
const CHEVRONS = Array.from({ length: Math.floor((X1 - X0 - 24) / 12) + 1 }, (_, i) => X0 + 12 + i * 12);

function DataGraph({ tc, anchors }: { tc: number; anchors: Anchors | null }) {
  if (tc < NEEDS[2].fly - 0.2) return null;
  return (
    <>
      {/* The needs as rows in one hairline list. */}
      <div
        className={`flex flex-col rounded-2xl bg-white p-2 ${EDGE}`}
        style={{ left: LIST.x, top: LIST.y, width: LIST.w, height: LIST.h, ...blurIn(tc, NEEDS[0].fly + 0.35, 0.45, 0) }}
      >
        {NEEDS.map((n) => {
          const Icon = n.icon;
          return (
            <span key={n.id} data-state={statusAt(n, tc)} className="group flex flex-1 items-center px-2 not-first:border-t not-first:border-[#ededf0]">
              <span
                className={`grid size-[30px] place-items-center rounded-full text-[#1d1d1f] transition-[color,border-color] duration-300 group-data-[state=ok]:border-[rgb(31_157_85/0.35)] group-data-[state=ok]:text-[#1f9d55] motion-reduce:transition-none ${EDGE}`}
              >
                <Icon className="size-[15px]" />
              </span>
            </span>
          );
        })}
      </div>
      <svg
        className="top-0 left-0 overflow-visible stroke-[#a1a1a6] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]"
        width="1200"
        height="600"
        viewBox="0 0 1200 600"
        fill="none"
      >
        {NEEDS.map((n) => {
          const a = ramp(tc, n.draw, n.draw + 0.3);
          const b = ramp(tc, n.draw + 0.5, n.draw + 0.8);
          const status = statusAt(n, tc);
          // While a fetch is in flight, a glow runs along its rail.
          const flow = status === "loading" ? (tc * 1.6) % 1 : -1;
          return a > 0 ? (
            <g key={n.id} data-tone={status} className="data-[tone=ok]:stroke-[#1f9d55]">
              {CHEVRONS.map((x) => {
                const u = (x - X0) / (X1 - X0);
                if (u <= 0.5 ? u > a * 0.5 : u - 0.5 > b * 0.5) return null;
                const glow = flow < 0 ? 1 : 0.3 + 0.7 * Math.max(0, 1 - Math.abs(u - flow) * 6);
                return <path key={x} d={`M${x - 2} ${n.y - 4} L${x + 2} ${n.y} L${x - 2} ${n.y + 4}`} opacity={glow.toFixed(3)} />;
              })}
            </g>
          ) : null;
        })}
      </svg>
      {NEEDS.map((n) => (
        <Label key={n.id} need={n} tc={tc} anchors={anchors} />
      ))}
      {/* What runs against each tool, on its rail: in flight, then resolved. */}
      {NEEDS.map((n) => {
        const at = n.draw + 0.25;
        if (tc < at) return null;
        const ok = tc >= n.draw + OK_AFTER;
        return (
          <span
            key={n.id}
            data-ok={ok || undefined}
            className={`inline-flex h-8 items-center gap-[7px] rounded-full bg-white pr-3 pl-2.5 font-mono text-[12.5px] whitespace-nowrap shadow-[0_10px_24px_-14px_rgb(16_24_40/0.3)] transition-[border-color] duration-300 [transform:translate(-50%,-50%)] data-ok:border-[rgb(31_157_85/0.35)] motion-reduce:transition-none ${EDGE}`}
            style={{ left: XM, top: n.y, ...blurIn(tc, at, 0.35, 0) }}
          >
            {ok ? <Check className="size-3.5 stroke-[2.4] text-[#1f9d55]" /> : <Spinner />}
            {n.call}
          </span>
        );
      })}
      {NEEDS.map((n, i) => {
        const at = 3.9 + i * 0.1;
        if (tc < at) return null;
        const bump = ramp(tc, n.draw + 0.8, n.draw + 0.92) * (1 - ramp(tc, n.draw + 0.92, n.draw + 1.25));
        return (
          <div
            key={n.id}
            className={`flex items-center gap-3 rounded-[14px] bg-white px-3 ${EDGE}`}
            style={{
              left: SRC.x,
              top: n.y - SRC.h / 2,
              width: SRC.w,
              height: SRC.h,
              scale: `${1 + bump * 0.04}`,
              ...blurIn(tc, at, 0.5, 0),
            }}
          >
            <span className={`grid size-[34px] shrink-0 place-items-center rounded-[10px] ${EDGE}`} style={{ background: n.tool.brand.color }}>
              <BrandMark brand={n.tool.brand} className="size-5 bg-white" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] leading-[19px] font-medium tracking-[-0.015em]">{n.tool.brand.name}</span>
              <span className="font-mono text-[11.5px] leading-[15px] text-[#6e6e73]">{n.tool.meta}</span>
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Camera: hold on the question, ease in on the graph, then down to the dashboard as it streams, a push for the refresh, and back for the loop. */
const CAMERA: CamKey[] = [
  [0, 600, 300, 1],
  [3.4, 600, 300, 1],
  [7.2, 600, 300, 1.12],
  [7.6, 600, 300, 1.12],
  [8.5, VIEW.cx, VIEW.cy, VIEW.s],
  [10.4, VIEW.cx, VIEW.cy, VIEW.s],
  [11.2, PUSH.cx, PUSH.cy, PUSH.s],
  [14.0, PUSH.cx, PUSH.cy, PUSH.s],
  [14.7, VIEW.cx, VIEW.cy, VIEW.s],
  [15.3, VIEW.cx, VIEW.cy, VIEW.s],
  [16.0, 600, 300, 1],
];

const CAMERA_NARROW: CamKey[] = CAMERA.map(([t, x, y, s]) => [t, x, y, s === 1.12 ? 0.95 : s === PUSH.s ? 0.88 : s]);

/** The dashboard's three captures: as built, refreshing, and with the new numbers. */
const shotAt = (tc: number) =>
  `/landing/dashboards/story${tc >= REFRESH_AT ? "-refreshed" : tc >= UPDATING_AT ? "-updating" : ""}-light.png`;

/**
 * The film, drawn in a 1200×600 world that scales with its stage like an
 * image. Phones show the central 900px, where every subject sits.
 */
export function StoryFilm({ T }: { T: number }) {
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const tc = T >= RESET ? 0 : T;
  const cam = camAt(useNarrow() ? CAMERA_NARROW : CAMERA, T);
  // The loop whips back to the start through a short blur.
  const whip = ramp(T, 15.3, 16);
  const blur = Math.sin(Math.PI * whip) * 8;

  return (
    <div className="absolute top-0 left-0 h-150 w-300 origin-top-left overflow-hidden text-left font-sans text-[#1d1d1f] [--stage-width:100cqw] [scale:tan(atan2(var(--stage-width),1200px))] max-md:[scale:none] max-md:[transform:scale(tan(atan2(var(--stage-width),900px)))_translateX(-150px)]">
      <div
        aria-hidden
        className="absolute top-0 left-0 origin-top-left *:absolute *:box-border"
        style={
          {
            transform: `translate(${(600 - cam.cx * cam.s).toFixed(2)}px, ${(300 - cam.cy * cam.s).toFixed(2)}px) scale(${cam.s.toFixed(4)})`,
            filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
          } as CSSProperties
        }
      >
        {tc < 9 ? (
          <>
            <Query tc={tc} anchors={anchors} onMeasure={setAnchors} />
            <DataGraph tc={tc} anchors={anchors} />
          </>
        ) : null}
        {tc >= BUILD_AT ? (
          <div style={{ left: DASH.x, top: DASH.y, width: DASH.w, height: DASH.h }}>
            <div className={`absolute inset-0 overflow-hidden rounded-[20px] bg-white ${EDGE}`}>
              {/* Rendered once with the OpenUI Dashboards UI library: it rises in at the build, and the refresh lands newer numbers in place. */}
              <Image
                src={shotAt(tc)}
                alt=""
                width={2000}
                height={1616}
                sizes="1000px"
                className="block h-auto w-full"
                style={blurIn(tc, BUILD_AT, 0.6, 14)}
              />
              {/* While the data refetches, a highlight sweeps across the dashboard on the film's clock, about once a second. */}
              {tc >= UPDATING_AT && tc < REFRESH_AT + 0.3 ? (
                <span
                  className="pointer-events-none absolute inset-0 z-1 bg-[linear-gradient(105deg,transparent_35%,rgb(255_255_255/0.7)_50%,transparent_65%)] bg-size-[250%_100%] bg-no-repeat"
                  style={{
                    backgroundPosition: `${(130 - (((tc - UPDATING_AT) % 1.1) / 1.1) * 160).toFixed(1)}% 0`,
                    opacity: ramp(tc, UPDATING_AT, UPDATING_AT + 0.3) * (1 - ramp(tc, REFRESH_AT, REFRESH_AT + 0.3)),
                  }}
                />
              ) : null}
              {tc >= UPDATING_AT && tc < NOTCH_OUT[1] ? <Notch tc={tc} /> : null}
            </div>
          </div>
        ) : null}
      </div>
      {/* The later captures, loaded early so each swap is instant. */}
      {["updating", "refreshed"].map((state) => (
        <Image key={state} src={`/landing/dashboards/story-${state}-light.png`} alt="" width={2000} height={1616} sizes="1000px" loading="eager" className="hidden" />
      ))}
    </div>
  );
}

/**
 * "Updating data…", then "Up to date": a solid tab hanging from a line along
 * the dashboard's top edge, blue while it works and green once it's done. It
 * drops in, confirms, and lifts away.
 */
function Notch({ tc }: { tc: number }) {
  const done = tc >= REFRESH_AT;
  const fade = ramp(tc, NOTCH_OUT[0], NOTCH_OUT[1]);
  return (
    <>
      <span
        data-done={done || undefined}
        className="absolute inset-x-0 top-0 z-2 h-0.5 bg-[#4b4bf7] data-done:bg-[#1f9d55]"
        style={{ opacity: ramp(tc, UPDATING_AT, UPDATING_AT + 0.35) * (1 - fade) }}
      />
      <span
        data-done={done || undefined}
        className="absolute top-0 left-1/2 isolate z-2 box-border inline-flex h-[26px] w-[168px] items-center justify-center text-[13px] font-medium whitespace-nowrap text-white [--tone:#4b4bf7] before:absolute before:inset-0 before:-z-1 before:origin-top before:rounded-b-[9px] before:bg-(--tone) before:[transform:perspective(36px)_rotateX(-10deg)] data-done:[--tone:#1f9d55]"
        style={
          tc >= NOTCH_OUT[0]
            ? { opacity: 1 - fade, translate: `-50% ${(-fade * 100).toFixed(1)}%` }
            : { translate: `-50% ${((ramp(tc, UPDATING_AT, UPDATING_AT + 0.35) - 1) * 100).toFixed(1)}%` }
        }
      >
        <span className="inline-flex -translate-y-px items-center gap-[7px]">
          {done ? (
            <>
              <Check className="size-[13px] stroke-[2.75]" /> Up to date
            </>
          ) : (
            <>
              <i className="size-[11px] animate-spin rounded-full border-[1.75px] border-white/35 border-t-white [animation-duration:0.8s]" /> Updating data…
            </>
          )}
        </span>
      </span>
    </>
  );
}
