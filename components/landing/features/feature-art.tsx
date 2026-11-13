"use client";

import { ArrowUp, Check, MousePointer2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { useReducedMotion } from "../use-reduced-motion";

/*
 * The four feature scenes. Every dashboard in them was rendered once with the
 * OpenUI Dashboards UI library (public/landing/dashboards/feat-*.png, captured at
 * 1180px wide); these scenes only frame, crossfade and point. Each is a
 * 588×360 scene scaled to its card's width.
 */

/** A looping script: `step` counts through `durations` (seconds each) and wraps. Reduced motion rests on `still`. */
function useSteps(durations: readonly number[], still: number) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % durations.length), durations[step] * 1000);
    return () => clearTimeout(t);
  }, [step, reduced, durations]);
  return reduced ? still : step;
}

/* ---------- The shared frame: a white-rim device on the card's stage ---------- */

/** The screen's corner in scene px. Scenes are laid out against 880px-wide shots. */
const SCREEN = { x: 97, y: 41 };
/** The dashboards show at 53% (470/880), so the KPIs and charts read whole; they were captured 1180px wide, so they run off the screen's right edge. */
const z = 470 / 880;
const SHOT_WIDTH = 1180 * z;

/** A card of the dashboard, from shot px to screen px. */
type Rect = { x: number; y: number; w: number; h: number };
const zoomed = (r: Rect) => ({ left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z });
const around = (r: Rect, pad: number) => {
  const b = zoomed(r);
  return { left: b.left - pad, top: b.top - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
};

/** The blocks of the revenue dashboard, in shot px (measured in the capture). */
const FILTER_BAR: Rect = { x: 56, y: 38, w: 540, h: 42 };
const KPI_STRIP: Rect = { x: 57, y: 107, w: 1067, h: 120 };
const CHART_CARD: Rect = { x: 56, y: 252, w: 526, h: 400 };
const FUNNEL_CARD: Rect = { x: 598, y: 252, w: 526, h: 400 };

/**
 * The device frame: a screen with a white rim, set in from the card's top-left
 * on the dither stage and running off its right and bottom edges, at every width.
 */
function Device({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <div
      aria-hidden
      className="absolute top-0 left-0 h-90 w-147 origin-top-left [--stage-width:100cqw] [transform:scale(tan(atan2(var(--stage-width),588px)))]"
    >
      <div className="absolute top-8 left-22 box-border h-120 w-160 rounded-tl-[22px] bg-white pt-[9px] pl-[9px] shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_22px_44px_rgb(0_0_0/0.1)]">
        {/* The screen takes the captures' own page colour, so a zoomed-out shot meets it without an edge. */}
        <div className="relative h-full overflow-hidden rounded-tl-[14px] bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]">
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** One captured dashboard. */
function Shot({ name }: { name: string }) {
  return (
    <Image
      src={`/landing/dashboards/feat-${name}-light.png`}
      alt=""
      width={2360}
      height={1440}
      sizes="640px"
      className="block h-auto max-w-none"
      style={{ width: SHOT_WIDTH }}
    />
  );
}

/** The captured states of one dashboard, crossfading to `active`. The first stays underneath, so a crossfade never thins the shot. */
function Shots({ names, active }: { names: string[]; active: string }) {
  return names.map((name) => (
    <span
      key={name}
      data-on={name === active || undefined}
      className="absolute inset-0 opacity-0 transition-opacity duration-280 first:opacity-100 data-on:opacity-100"
    >
      <Shot name={name} />
    </span>
  ));
}

/* ---------- The chat bar: a placeholder, then an ask typed out ---------- */

function Composer({
  ask,
  on,
  typed,
  pressed,
  style,
}: {
  ask: string;
  on: boolean;
  typed: boolean;
  pressed: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      data-on={on || undefined}
      className="absolute top-[258px] left-[45px] z-2 box-border flex h-10 w-95 translate-y-3.5 items-center justify-between gap-2.5 rounded-full border border-[rgb(10_10_11/0.1)] bg-white pr-1.5 pl-3.5 text-[13px] text-[#0a0a0b] opacity-0 shadow-[0_12px_28px_-12px_rgb(16_24_40/0.4)] transition-[opacity,translate] duration-300 data-on:translate-y-0 data-on:opacity-100"
      style={style}
    >
      <span className="relative min-w-0 flex-1 whitespace-nowrap">
        <span data-hidden={typed || undefined} className="text-[rgb(10_10_11/0.45)] data-hidden:invisible">
          Ask anything…
        </span>
        {/* The ask, typed out a letter at a time. */}
        <span
          data-on={typed || undefined}
          className="absolute top-0 left-0 [clip-path:inset(0_100%_0_0)] data-on:[clip-path:inset(0_0_0_0)] data-on:[transition:clip-path_1.1s_steps(var(--chars,28),end)]"
          style={{ "--chars": ask.length } as CSSProperties}
        >
          {ask}
        </span>
      </span>
      <i
        data-ready={typed || undefined}
        data-pressed={pressed || undefined}
        className="grid size-7 flex-none place-items-center rounded-full bg-[rgb(10_10_11/0.15)] text-white [transition:background-color_200ms_ease,scale_120ms_ease] data-pressed:scale-[0.86] data-ready:bg-[#0a0a0b]"
      >
        <ArrowUp size={13} strokeWidth={2.5} />
      </i>
    </span>
  );
}

/* ---------- Conversational: ask, and the dashboard is built ---------- */

const CONV_ASK = "How’s our revenue doing?";
const CONV_STEPS = [0.9, 1.5, 0.4, 3.4, 0.6] as const;
/** The blocks in the order they arrive. */
const PIECES = [FILTER_BAR, KPI_STRIP, CHART_CARD, FUNNEL_CARD];
/** Room around each block for its border and shadow, in screen px. */
const PIECE_PAD = 5;

/** An empty screen and the ask box in its centre; the question is typed and sent, the box goes, and the dashboard is built block by block. */
export function ConversationalArt() {
  /* 0 empty, 1 typed, 2 sent, 3 built, 4 clears for the next loop. */
  const step = useSteps(CONV_STEPS, 3);
  const built = step === 3;
  return (
    <Device>
      {PIECES.map((piece, i) => {
        const box = around(piece, PIECE_PAD);
        return (
          // One block of the dashboard, cut out of the capture, rising in after the one before.
          <span
            key={piece.x + piece.y}
            data-on={built || undefined}
            className="absolute translate-y-2 overflow-hidden opacity-0 [filter:blur(4px)] [transition:opacity_250ms_ease,filter_250ms_ease,translate_250ms_ease] data-on:translate-y-0 data-on:opacity-100 data-on:[filter:none] data-on:[transition:opacity_450ms_ease_var(--delay),filter_450ms_ease_var(--delay),translate_450ms_ease_var(--delay)]"
            style={{ ...box, "--delay": `${i * 180}ms` } as CSSProperties}
          >
            <span className="absolute" style={{ left: -box.left, top: -box.top }}>
              <Shot name="wide-a" />
            </span>
          </span>
        );
      })}
      <Composer ask={CONV_ASK} on={step <= 2} typed={step >= 1 && step <= 2} pressed={step === 2} style={{ top: 140 }} />
    </Device>
  );
}

/* ---------- Targeted edits: one widget is generated again ---------- */

/** The wide traffic chart (Top sources sits to its right), in shot px. */
const SITES_CARD: Rect = { x: 56, y: 252, w: 707, h: 400 };
const EDIT_ASK = "Can you compare this across all sites?";
const EDIT_STEPS = [1.2, 0.7, 1.7, 0.4, 1.6, 1.6, 1.2] as const;

/** The dashboard; the chat bar opens and asks for every site; only the chart refreshes and comes back with them all. */
export function EditWidgetArt() {
  /* 0 the dashboard, 1 the bar opens, 2 typed, 3 sent, 4 only the chart refreshes, 5 it's back with every site, 6 hold. */
  const step = useSteps(EDIT_STEPS, 5);
  const card = zoomed(SITES_CARD);
  return (
    <Device>
      <Shots names={["wide-sites-one", "wide-sites-all"]} active={step >= 5 ? "wide-sites-all" : "wide-sites-one"} />
      {/* Only this card takes the library's refreshing state, with a sweep. */}
      <span
        data-on={step === 4 || undefined}
        className="absolute z-1 overflow-hidden rounded-[9px] opacity-0 transition-opacity duration-300 data-on:opacity-100"
        style={card}
      >
        <span className="absolute" style={{ left: -card.left, top: -card.top }}>
          <Shot name="wide-sites-updating" />
        </span>
        <span className="absolute inset-0 animate-[landing-sweep_1.1s_linear_infinite] bg-[linear-gradient(105deg,transparent_35%,rgb(255_255_255/0.8)_50%,transparent_65%)] bg-size-[250%_100%]" />
      </span>
      <span
        data-on={step === 4 || step === 5 || undefined}
        className="pointer-events-none absolute z-1 box-border rounded-xl border-2 border-[#6d5efc] opacity-0 shadow-[0_0_0_4px_rgb(109_94_252/0.14)] transition-opacity duration-300 data-on:opacity-100"
        style={around(SITES_CARD, 3)}
      />
      <Composer ask={EDIT_ASK} on={step >= 1 && step <= 3} typed={step >= 2 && step <= 3} pressed={step === 3} />
    </Device>
  );
}

/* ---------- Interactive: pick a plan, every widget follows ---------- */

/** The Plan chips, in the order the cursor clicks them, with the capture each one shows: centres in shot px. */
const PLAN_CHIPS = [
  { shot: "plan-enterprise", x: 381, y: 59 },
  { shot: "plan-business", x: 472, y: 59 },
  { shot: "plan-team", x: 548, y: 59 },
  { shot: "plan-all", x: 291, y: 59 },
];
const REST = { x: 500, y: 300 };
/** The pointer's tip sits a few px in from the icon's corner. */
const TIP = { x: 3, y: 2 };
const FILTER_STEPS = [0.9, 0.6, 1.6, 0.45, 1.6, 0.45, 1.6, 0.5, 1.2] as const;

/** A pointer clicks through the Plan chips, and every widget filters to that plan. */
export function HoverArt() {
  /* 0 resting on All plans; then for each chip, a move (odd steps) and a click (even steps). */
  const step = useSteps(FILTER_STEPS, 4);
  const clicked = Math.floor(step / 2);
  const showing = clicked === 0 ? "plan-all" : PLAN_CHIPS[clicked - 1].shot;
  const target = step >= 1 ? PLAN_CHIPS[Math.floor((step - 1) / 2)] : null;
  const cursor = target ? { x: SCREEN.x + target.x * z - TIP.x, y: SCREEN.y + target.y * z - TIP.y } : REST;
  return (
    <Device
      overlay={
        <MousePointer2
          data-quick={(step >= 3 && step % 2 === 1) || undefined}
          data-click={(step >= 2 && step % 2 === 0) || undefined}
          className="absolute top-0 left-0 z-2 fill-white text-[#0a0a0b] drop-shadow-[0_1px_2px_rgb(0_0_0/0.25)] [transition:translate_700ms_cubic-bezier(0.65,0,0.25,1),opacity_250ms_ease] data-click:animate-[landing-cursor-click_240ms_ease] data-quick:[transition-duration:480ms]"
          style={{ translate: `${cursor.x}px ${cursor.y}px` }}
          size={20}
          strokeWidth={1.5}
        />
      }
    >
      <Shots names={["plan-all", ...PLAN_CHIPS.slice(0, 3).map((c) => c.shot)]} active={showing} />
    </Device>
  );
}

/* ---------- Live updates: only the numbers change ---------- */

/** Two KPI values in the live capture: where they sit (shot px) and what they roll between. Both strings keep their length, so each digit has a column. */
const COUNTERS = [
  { x: 81, y: 153, w: 103, from: "$12,480", to: "$14,960" },
  { x: 348, y: 153, w: 71, from: "1,184", to: "1,462" },
];
const VALUE_HEIGHT = 29;
const LIVE_STEPS = [0.9, 0.9, 0.45, 1.0, 0.5, 0.9, 0.6] as const;
const DIGITS = [..."01234567890123456789"];

/** A number rolling up to its new value: each changed digit is a strip of 0–9 (twice, so it can always roll upward) slid to its new place. */
function Rolling({ from, to, rolled }: { from: string; to: string; rolled: boolean }) {
  return [...to].map((char, i) => {
    const a = Number(from[i]);
    const b = Number(char);
    if (Number.isNaN(a) || Number.isNaN(b)) return <span key={i}>{char}</span>;
    const at = rolled ? (b >= a ? b : b + 10) : a;
    return (
      <span key={i} className="inline-block h-[1.1em] overflow-hidden align-top">
        <span
          data-rolled={rolled || undefined}
          className="flex flex-col data-rolled:[transition:translate_0.75s_cubic-bezier(0.2,0.75,0.2,1)_var(--delay)]"
          style={{ translate: `0 ${-at * 1.1}em`, "--delay": `${i * 40}ms` } as CSSProperties}
        >
          {DIGITS.map((d, j) => (
            <span key={j}>{d}</span>
          ))}
        </span>
      </span>
    );
  });
}

/** Patches and counters show at once, and hide only after the new capture has crossfaded in under them. */
const SWAP_IN = "absolute opacity-0 [transition:opacity_250ms_ease_320ms] data-on:opacity-100 data-on:[transition:none]";

/** The notch drops in; everything but the numbers fades back, the numbers roll up, and the notch says done and lifts away. */
export function LiveArt() {
  /* 0 the dashboard, 1 the notch drops in and it shimmers, 2 all but the numbers fades to 40%, 3 the numbers roll, 4 it fades back and the notch says done, 5 hold, 6 the notch lifts away. */
  const step = useSteps(LIVE_STEPS, 5);
  const faded = step === 2 || step === 3;
  const done = step >= 4;
  const notch = step >= 1 && step <= 5;
  const shot = step >= 4 ? "live-b" : step === 1 ? "live-updating" : "live-a";
  return (
    <Device>
      <span data-faded={faded || undefined} className="absolute inset-0 transition-opacity duration-350 data-faded:opacity-40">
        <Shots names={["live-a", "live-updating", "live-b"]} active={shot} />
        {/* Card-coloured patches over the captured values. They fade with the dashboard, so they read as the card. */}
        {COUNTERS.map((c) => (
          <span
            key={c.x}
            data-on={faded || undefined}
            className={`${SWAP_IN} bg-white`}
            style={{ left: c.x * z - 1, top: c.y * z - 1, width: c.w * z + 6, height: VALUE_HEIGHT * z + 2 }}
          />
        ))}
      </span>
      {/* The numbers, at full strength while the rest is faded: the library's KPI value type. */}
      {COUNTERS.map((c) => (
        <span
          key={c.x}
          data-on={faded || undefined}
          className={`${SWAP_IN} z-1 font-sans leading-[1.1] font-semibold tracking-[-0.025em] whitespace-nowrap text-[#0a0a0b] tabular-nums`}
          style={{ left: c.x * z, top: c.y * z, fontSize: 26 * z }}
        >
          <Rolling from={c.from} to={c.to} rolled={step === 3 || step === 4} />
        </span>
      ))}
      {/* The story film's notch, at the dashboard's scale, hanging from the screen's top edge above the filter row. */}
      <span
        data-done={done || undefined}
        data-on={notch || undefined}
        className="absolute inset-x-0 top-0 z-2 h-[3px] bg-[#4b4bf7] opacity-0 transition-opacity duration-280 data-done:bg-[#1f9d55] data-on:opacity-100"
      />
      <span
        data-done={done || undefined}
        data-on={notch || undefined}
        className="absolute top-0 left-[245px] isolate z-2 box-border inline-flex h-[15px] w-20 -translate-x-1/2 -translate-y-full items-center justify-center text-[8.5px] font-medium whitespace-nowrap text-white opacity-0 transition-[translate,opacity] duration-280 [--tone:#4b4bf7] before:absolute before:inset-0 before:-z-1 before:origin-top before:rounded-b-md before:bg-(--tone) before:[transform:perspective(21px)_rotateX(-10deg)] data-done:[--tone:#1f9d55] data-on:translate-y-0 data-on:opacity-100"
      >
        <span className="inline-flex -translate-y-[0.5px] items-center gap-1">
          {done ? (
            <>
              <Check className="size-2 stroke-[2.75]" /> Done
            </>
          ) : (
            <>
              <i className="size-[7px] animate-spin rounded-full border-[1.25px] border-white/35 border-t-white [animation-duration:0.8s]" /> Updating…
            </>
          )}
        </span>
      </span>
    </Device>
  );
}
