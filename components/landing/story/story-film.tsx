"use client";

import { ArrowUp, Check, CreditCard, Link2, MousePointerClick, UserRoundPlus, Users, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";

import { BrandMark } from "../brand-mark";
import { BRANDS, type Brand } from "../brands";
import { blurIn, blurSwap, camAt, lerp, ramp, type CamKey } from "./motion";

/*
 * The story film, in four beats, as one continuous shot. Connect: PostHog, your
 * database and Stripe connect one after another, then fold into one circle,
 * the question's send button. Build a dashboard: the input grows out of that
 * button, a question is asked, the data it needs flies out of the sentence,
 * each piece is fetched from the tool that has it, and the dashboard streams
 * in. Share: the dashboard is shared with the team. Always current: the shared
 * dashboard refreshes with new numbers. Every frame is a pure function of T.
 * World units are px in a 1200×600 viewport.
 */

/** The build runs on its own clock from here: the input, the question, the fetch, the dashboard. */
const BUILD_FROM = 2.6;
/** Where Share hands over to the live refresh. */
const LIVE_FROM = 17.3;
export const FILM_LENGTH = LIVE_FROM + 5.6;
export const FILM_STEPS = [
  { id: "connect", start: 0, length: BUILD_FROM },
  { id: "build", start: BUILD_FROM, length: 10.4 },
  { id: "share", start: BUILD_FROM + 10.4, length: LIVE_FROM - BUILD_FROM - 10.4 },
  { id: "live", start: LIVE_FROM, length: FILM_LENGTH - LIVE_FROM },
] as const;
/** The moment reduced motion rests on: every need fetched. */
export const FILM_STILL = BUILD_FROM + 6.9;
/** The loop whips back through a short blur, and restarts in the middle of it. */
const WHIP: [number, number] = [FILM_LENGTH - 0.7, FILM_LENGTH];
const RESET = FILM_LENGTH - 0.3;

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
/** On the build's clock: when the dashboard streams in. */
const BUILD_AT = 8.0;
const VIEW = { cx: 600, cy: DASH.y + DASH.h / 2, s: 0.78 };

/** Connect: each tool's button is pressed in turn and connects. Its pill keeps one width, so nothing shifts as its label changes. */
const CONNECT_AT = [0.75, 1.05, 1.35];
const CONNECTING = 0.3;
const CONNECT_W = 340;
const CONNECT_PILL = 116;
/** Then the tiles fold into one circle in the middle: the input at its smallest, around where its send button appears. */
const FOLD: [number, number] = [1.95, 2.55];
/** On the build's clock: the send button pops in, then the input grows sideways from it, the button riding its right end. */
const BUTTON_IN: [number, number] = [0, 0.25];
const GROW: [number, number] = [0.05, 0.5];

/*
 * Share, on the film's clock: Share sits at the dashboard's top right, level with its title. It's
 * pressed, the share panel invites three teammates and copies the link, then closes, and the
 * teammates' avatars land beside the button.
 */
const SHARE = { right: 53, top: 34, h: 40, panel: 300 };
const SHARE_AT = 12.9;
const SHARE_PUSH: [number, number] = [13.5, 14.3];
const PRESS_AT = 14.45;
const PANEL_AT = 14.6;
const INVITES = [
  { initial: "M", name: "Maya", tone: "#ba625c", role: "Can edit", at: 14.95 },
  { initial: "J", name: "Jon", tone: "#6357e0", role: "Can view", at: 15.3 },
  { initial: "A", name: "Ana", tone: "#d62ee8", role: "Can edit", at: 15.65 },
];
const COPY_AT = 16.2;
const PANEL_OUT = 16.8;
const JOINED_AT = 16.95;
const SHARE_CAM = { cx: 640, cy: DASH.y + 150, s: 1.1 };
/** Connect is framed close, then eases out to the question's framing as the input grows. */
const CONNECT_CAM = 1.3;

/** "Always current": the notch drops in and the dashboard refreshes, then the new numbers land at REFRESH_AT and the notch confirms and lifts away. */
const UPDATING_AT = LIVE_FROM + 0.5;
const REFRESH_AT = LIVE_FROM + 1.8;
const NOTCH_OUT: [number, number] = [LIVE_FROM + 3.2, LIVE_FROM + 3.6];
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
            // It grows sideways out of the send button the tools folded into; the button rides its right end.
            width: lerp(INPUT.h, INPUT.w, ramp(tc, GROW[0], GROW[1])),
            height: INPUT.h,
            ...(m > 0 ? { opacity: 1 - m, filter: `blur(${(m * 6).toFixed(2)}px)` } : null),
          }}
        >
          <span
            data-ready={tc > 1.25 || undefined}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#e5e5ea] text-white data-ready:bg-[#0a0a0b]"
            style={{
              scale: `${lerp(0.5, 1, ramp(tc, BUTTON_IN[0], BUTTON_IN[1])) - press * 0.12}`,
              opacity: ramp(tc, BUTTON_IN[0], BUTTON_IN[1]),
            }}
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
            <ToolTile need={n} />
          </div>
        );
      })}
    </>
  );
}

/** Camera: hold on the tools and the question, ease in on the graph, then down to the dashboard as it streams, a push to Share, and back for the loop. */
const CAMERA: CamKey[] = [
  [0, 600, 300, CONNECT_CAM],
  [FOLD[0], 600, 300, CONNECT_CAM],
  [BUILD_FROM + GROW[1], 600, 300, 1],
  [BUILD_FROM + 3.4, 600, 300, 1],
  [BUILD_FROM + 7.2, 600, 300, 1.12],
  [BUILD_FROM + 7.6, 600, 300, 1.12],
  [BUILD_FROM + 8.5, VIEW.cx, VIEW.cy, VIEW.s],
  [SHARE_PUSH[0], VIEW.cx, VIEW.cy, VIEW.s],
  [SHARE_PUSH[1], SHARE_CAM.cx, SHARE_CAM.cy, SHARE_CAM.s],
  [LIVE_FROM, SHARE_CAM.cx, SHARE_CAM.cy, SHARE_CAM.s],
  [LIVE_FROM + 0.7, PUSH.cx, PUSH.cy, PUSH.s],
  [NOTCH_OUT[1], PUSH.cx, PUSH.cy, PUSH.s],
  [NOTCH_OUT[1] + 0.7, VIEW.cx, VIEW.cy, VIEW.s],
  [WHIP[0], VIEW.cx, VIEW.cy, VIEW.s],
  [WHIP[1], 600, 300, CONNECT_CAM],
];

const CAMERA_NARROW: CamKey[] = CAMERA.map(([t, x, y, s]) => [
  t,
  x,
  y,
  s === 1.12 ? 0.95 : s === SHARE_CAM.s ? 0.9 : s === PUSH.s ? 0.88 : s === CONNECT_CAM ? 1.15 : s,
]);

/** The dashboard's three captures: as built, refreshing, and with the new numbers. */
const shotAt = (tc: number) =>
  `/landing/dashboards/story${tc >= REFRESH_AT ? "-refreshed" : tc >= UPDATING_AT ? "-updating" : ""}-light.png`;



/** A tool's tile: its mark on its brand colour, its name and what it holds. */
function ToolTile({ need, className = "" }: { need: NeedSpec; className?: string }) {
  return (
    <>
      <span className={`grid size-[34px] shrink-0 place-items-center rounded-[10px] ${EDGE}`} style={{ background: need.tool.brand.color }}>
        <BrandMark brand={need.tool.brand} className="size-5 bg-white" />
      </span>
      <span className={`flex min-w-0 flex-col ${className}`}>
        <span className="text-[15px] leading-[19px] font-medium tracking-[-0.015em]">{need.tool.brand.name}</span>
        <span className="font-mono text-[11.5px] leading-[15px] text-[#6e6e73]">{need.tool.meta}</span>
      </span>
    </>
  );
}

/**
 * Connect: the three tools, each connected in turn. Then all three fold into one circle in the
 * middle: the input at its smallest, which the send button appears in and the input grows from.
 * Each pill stays dark while it connects and turns green with a small pop: no colour fade, so it
 * never passes through grey, and it keeps one width, so nothing shifts.
 */
function Connect({ tc }: { tc: number }) {
  const fold = ramp(tc, FOLD[0], FOLD[1]);
  const content = 1 - ramp(tc, FOLD[0], FOLD[0] + 0.25);
  return NEEDS.map((n, i) => {
    const at = CONNECT_AT[i];
    const state = tc < at ? "idle" : tc < at + CONNECTING ? "loading" : "ok";
    const press = ramp(tc, at - 0.08, at) * (1 - ramp(tc, at + 0.05, at + 0.2));
    const pop = ramp(tc, at + CONNECTING, at + CONNECTING + 0.12) * (1 - ramp(tc, at + CONNECTING + 0.12, at + CONNECTING + 0.32));
    const w = lerp(CONNECT_W, INPUT.h, fold);
    const h = lerp(SRC.h, INPUT.h, fold);
    const cy = lerp(n.y, INPUT.y, fold);
    return (
      <div
        key={n.id}
        className={`flex items-center gap-3 overflow-hidden bg-white pr-3 pl-3 ${EDGE}`}
        style={{
          left: 600 - w / 2,
          top: cy - h / 2,
          width: w,
          height: h,
          borderRadius: lerp(14, INPUT.h / 2, fold),
          // It takes on the input's shadow as it becomes the input.
          boxShadow: `0 1px 2px rgb(16 24 40 / ${(0.06 * fold).toFixed(3)}), 0 8px 20px -10px rgb(16 24 40 / ${(0.22 * fold).toFixed(3)})`,
          ...(fold > 0 ? null : blurIn(tc, 0.15 + i * 0.1, 0.5, 8)),
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3" style={{ opacity: content }}>
          <ToolTile need={n} className="flex-1" />
          <span
            data-state={state}
            className={`inline-flex h-8 shrink-0 items-center justify-center gap-[7px] rounded-full bg-[#0a0a0b] text-[13px] font-medium whitespace-nowrap text-white data-[state=ok]:border-[rgb(31_157_85/0.35)] data-[state=ok]:bg-white data-[state=ok]:text-[#1f9d55] ${EDGE}`}
            style={{ width: CONNECT_PILL, scale: `${1 - press * 0.08 + pop * 0.05}` }}
          >
            {state === "ok" ? (
              <>
                <Check className="size-3.5 stroke-[2.4]" /> Connected
              </>
            ) : state === "loading" ? (
              <>
                <i className="size-[13px] animate-spin rounded-full border-[1.5px] border-white/35 border-t-white [animation-duration:0.8s] motion-reduce:animate-none" />
                Connecting
              </>
            ) : (
              "Connect"
            )}
          </span>
        </span>
      </div>
    );
  });
}

function Avatar({ initial, tone, className = "" }: { initial: string; tone: string; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`} style={{ background: tone }}>
      {initial}
    </span>
  );
}

/**
 * Share, at the dashboard's top right: pressed, its panel invites three teammates and copies the
 * link, then closes, and the teammates' avatars land beside the button. Padding follows the
 * site's buttons: x above, below and on the icon's side, 1.5x on the text's side.
 */
function Share({ tc }: { tc: number }) {
  if (tc < SHARE_AT) return null;
  const press = ramp(tc, PRESS_AT - 0.08, PRESS_AT) * (1 - ramp(tc, PRESS_AT + 0.05, PRESS_AT + 0.2));
  const copyPress = ramp(tc, COPY_AT - 0.08, COPY_AT) * (1 - ramp(tc, COPY_AT + 0.05, COPY_AT + 0.2));
  const close = ramp(tc, PANEL_OUT, PANEL_OUT + 0.35);
  return (
    <>
      <span className="absolute z-2 flex items-center gap-2.5" style={{ right: SHARE.right, top: SHARE.top, height: SHARE.h }}>
        {tc >= JOINED_AT ? (
          <span className="flex">
            {INVITES.map((p, i) => (
              <span key={p.initial} className="-ml-2 rounded-full ring-2 ring-white first:ml-0" style={blurIn(tc, JOINED_AT + i * 0.1, 0.4, 4)}>
                <Avatar initial={p.initial} tone={p.tone} className="size-[30px] text-[12.5px]" />
              </span>
            ))}
          </span>
        ) : null}
        <span
          className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-[#0a0a0b] pr-[15px] pl-2.5 text-[15px] leading-5 font-medium tracking-[-0.01em] text-white shadow-[0_1px_2px_rgb(16_24_40/0.12),0_6px_14px_-8px_rgb(16_24_40/0.4)]"
          style={{ scale: `${1 - press * 0.08}`, ...blurIn(tc, SHARE_AT, 0.45, 6) }}
        >
          <UserRoundPlus className="size-[18px]" strokeWidth={2} /> Share
        </span>
      </span>
      {tc >= PANEL_AT && close < 1 ? (
        <div
          className={`absolute z-3 origin-top-right rounded-2xl bg-white p-3.5 shadow-[0_2px_4px_rgb(16_24_40/0.06),0_18px_36px_-14px_rgb(16_24_40/0.3)] ${EDGE}`}
          style={{
            right: SHARE.right,
            top: SHARE.top + SHARE.h + 10,
            width: SHARE.panel,
            ...(close > 0 ? { opacity: 1 - close, filter: `blur(${(close * 6).toFixed(2)}px)` } : blurIn(tc, PANEL_AT, 0.45, -6)),
          }}
        >
          <span className="block px-1 text-[15px] leading-5 font-medium tracking-[-0.015em]">Share dashboard</span>
          <span className="mt-2 flex flex-col">
            {INVITES.map((p) => (
              <span key={p.initial} className="flex h-11 items-center gap-2.5 px-1" style={tc >= p.at ? blurIn(tc, p.at, 0.4, 4) : { opacity: 0 }}>
                <Avatar initial={p.initial} tone={p.tone} className="size-7 text-[12px]" />
                <span className="text-[14px] leading-5 font-medium">{p.name}</span>
                <span className="ml-auto text-[13px] leading-5 text-[#6e6e73]">{p.role}</span>
              </span>
            ))}
          </span>
          <span className="mt-2 block border-t border-[#ededf0] pt-3">
            <span
              data-copied={tc >= COPY_AT + 0.15 || undefined}
              className={`flex h-9 items-center justify-center gap-2 rounded-[10px] text-[14px] font-medium transition-[color,border-color] duration-300 data-copied:border-[rgb(31_157_85/0.35)] data-copied:text-[#1f9d55] motion-reduce:transition-none ${EDGE}`}
              style={{ scale: `${1 - copyPress * 0.04}` }}
            >
              {tc >= COPY_AT + 0.15 ? (
                <>
                  <Check className="size-4 stroke-[2.4]" /> Link copied
                </>
              ) : (
                <>
                  <Link2 className="size-4" /> Copy link
                </>
              )}
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}

/**
 * The film, drawn in a 1200×600 world that scales with its stage like an
 * image. Phones show the central 900px, where every subject sits.
 */
export function StoryFilm({ T }: { T: number }) {
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const tc = T >= RESET ? 0 : T;
  // The build's scenes keep their own timing, starting once the tools are connected.
  const tb = tc - BUILD_FROM;
  const cam = camAt(useNarrow() ? CAMERA_NARROW : CAMERA, T);
  // The loop whips back to the start through a short blur.
  const whip = ramp(T, WHIP[0], WHIP[1]);
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
        {tc < BUILD_FROM ? <Connect tc={tc} /> : null}
        {tb >= 0 && tb < 9 ? (
          <>
            <Query tc={tb} anchors={anchors} onMeasure={setAnchors} />
            <DataGraph tc={tb} anchors={anchors} />
          </>
        ) : null}
        {tb >= BUILD_AT ? (
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
                style={blurIn(tb, BUILD_AT, 0.6, 14)}
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
            {/* Outside the dashboard's clip, so the share panel can hang below its edge if it needs to. */}
            <Share tc={tc} />
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
