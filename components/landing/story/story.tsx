"use client";

import {
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutDashboard,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { FILM_LENGTH, FILM_STEPS, FILM_STILL, StoryFilm } from "./story-film";

/** One point per film step, in the film's order. */
const POINTS = [
  { id: "ask", Icon: MessageCircle, title: "Ask a question", description: "Ask in plain words. No SQL, no ticket." },
  { id: "fetch", Icon: Database, title: "Query every tool", description: "Each part of the answer comes from the tool that has it." },
  { id: "build", Icon: LayoutDashboard, title: "Get a dashboard", description: "The whole answer in one dashboard, across every source." },
  { id: "live", Icon: RefreshCw, title: "Always current", description: "When your data changes, the dashboard updates. No regeneration." },
];

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const readReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;
const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** How far into its own step the film is, from 0 to 1. */
const stepProgress = (T: number, index: number) => {
  const step = FILM_STEPS[index];
  return Math.min(1, Math.max(0, (T - step.start) / step.length));
};

/**
 * "All your data. One question away." The heading and lead, then the film on
 * a flat stage with its four steps under it. The film plays only while it's on
 * screen and not paused, and each step's rule tracks its clock; choosing a
 * step jumps the film to it. Under reduced motion the film rests on one
 * frame until the reader presses play.
 *
 * Below 1200px the steps become a swipeable rail that keeps the active one in
 * view; phones show one step at a time, with segments and arrows.
 */
export function Story() {
  const stage = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLOListElement>(null);
  // A reader's own swipe holds the rail where they put it for a few seconds.
  const railHeldUntil = useRef(0);
  const [time, setTime] = useState(0);
  const [started, setStarted] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const [pausedChoice, setPausedChoice] = useState<boolean | null>(null);
  const paused = pausedChoice ?? reducedMotion;
  const [visible, setVisible] = useState(false);
  const running = visible && !paused;
  const T = reducedMotion && !started ? FILM_STILL : time;
  const active = FILM_STEPS.findIndex((step) => T < step.start + step.length);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      // Cap the step so a background tab doesn't jump the film forward.
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      setTime((t) => (t + dt) % FILM_LENGTH);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  // Keep the active step in view on the rail as the film advances, unless the reader is scrolling it.
  useEffect(() => {
    const list = rail.current;
    const item = list?.children[active] as HTMLElement | undefined;
    if (!list || !item || !visible || list.scrollWidth <= list.clientWidth) return;
    if (Date.now() < railHeldUntil.current) return;
    const inset = parseFloat(getComputedStyle(list).scrollPaddingLeft) || 0;
    list.scrollTo({ left: item.offsetLeft - inset, behavior: reducedMotion ? "auto" : "smooth" });
  }, [active, visible, reducedMotion]);

  const holdRail = () => {
    railHeldUntil.current = Date.now() + 5000;
  };

  /** Jump to a step and play it from its start. */
  const goTo = (index: number) => {
    setTime(FILM_STEPS[index].start);
    setStarted(true);
    setPausedChoice(false);
  };

  return (
    <section
      aria-labelledby="story-title"
      className="pt-[clamp(7rem,13.4vw,12rem)] text-neutral-950 [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
    >
      <div className="mx-auto w-full max-w-[calc(75rem+2*var(--gutter))] px-(--gutter)">
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
          <h2
            id="story-title"
            className="font-(family-name:--font-display) text-2xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance md:max-w-[20ch] md:text-[clamp(1.875rem,4vw,2.5rem)]"
          >
            All your data.
            <br /> One question away.
          </h2>
          <p className="max-w-[34rem] text-base leading-normal text-pretty text-neutral-950/60 md:text-[17px]">
            Your tools, your databases and any MCP server. Ask once, and one dashboard pulls from all of them.
          </p>
        </div>

        {/* The film scales with the stage's width. Phones: edge to edge, on the film's central 900px. */}
        <div
          ref={stage}
          className="relative -mx-(--gutter) mt-8 aspect-[900/600] overflow-hidden border-y border-[#f8f8f8] bg-[#f8f8f8] [container-type:inline-size] md:mx-0 md:mt-16 md:aspect-[1200/600] md:rounded-3xl md:border"
        >
          <div className="absolute inset-0 z-1 overflow-hidden">
            <StoryFilm T={T} />
          </div>
          <button
            type="button"
            aria-label={paused ? "Play" : "Pause"}
            onClick={() => {
              if (paused && reducedMotion && !started) {
                setTime(FILM_STILL);
                setStarted(true);
              }
              setPausedChoice(!paused);
            }}
            className="absolute right-3 bottom-3 z-2 grid size-9 cursor-pointer place-items-center rounded-full border border-black/6 bg-white text-neutral-950 shadow-[0_1px_2px_rgb(22_34_51/0.06),0_1px_1px_rgb(22_34_51/0.04)] hover:border-black/12 md:right-5 md:bottom-5"
          >
            {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}
          </button>
        </div>

        {/* Phones: the film's progress as one segment per step. */}
        <span aria-hidden className="mt-6 grid auto-cols-fr grid-flow-col gap-1.5 md:hidden">
          {POINTS.map(({ id }, index) => (
            <span key={id} className="relative h-0.5 overflow-hidden rounded-[1px] bg-[rgb(127_127_132/0.25)]">
              <span
                className="absolute inset-0 origin-left bg-neutral-950"
                style={{ transform: `scaleX(${index < active ? 1 : index > active ? 0 : stepProgress(T, index)})` }}
              />
            </span>
          ))}
        </span>

        <ol
          ref={rail}
          onPointerDown={holdRail}
          onTouchStart={holdRail}
          onWheel={holdRail}
          className="-mx-(--gutter) mt-6 flex gap-4 overflow-x-hidden px-(--gutter) pb-1 md:mt-10 md:snap-x md:snap-mandatory md:scroll-px-(--gutter) md:gap-6 md:overflow-x-auto md:overscroll-x-contain [scrollbar-width:none] min-[75rem]:mx-0 min-[75rem]:grid min-[75rem]:grid-cols-4 min-[75rem]:overflow-visible min-[75rem]:px-0 min-[75rem]:pb-0 [&::-webkit-scrollbar]:hidden"
        >
          {POINTS.map(({ id, Icon, title, description }, index) => (
            <li
              key={id}
              data-active={index === active || undefined}
              className="group hidden min-w-0 basis-full text-pretty data-active:block md:block md:flex-[0_0_280px] md:snap-start"
            >
              <button
                type="button"
                aria-current={index === active ? "step" : undefined}
                onClick={() => goTo(index)}
                className="block w-full cursor-pointer pb-1 text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-[oklch(0.546_0.215_262.881/0.3)]"
              >
                <span aria-hidden className="block h-0.5 overflow-hidden rounded-[1px] bg-black/9 max-md:hidden">
                  <span
                    className="block size-full origin-left bg-neutral-950"
                    style={{ transform: `scaleX(${index === active ? stepProgress(T, index) : 0})` }}
                  />
                </span>
                <Icon
                  aria-hidden
                  size={20}
                  strokeWidth={1.75}
                  className="mt-5 block text-neutral-950/20 transition-colors duration-300 group-hover:text-neutral-950 group-data-active:text-neutral-950 motion-reduce:transition-none md:mt-6"
                />
                <span className="mt-2.5 block font-(family-name:--font-display) text-lg leading-[1.35] font-medium tracking-[-0.01em] text-neutral-950/60 transition-colors duration-300 group-hover:text-neutral-950 group-data-active:text-neutral-950 motion-reduce:transition-none md:mt-3.5">
                  {title}
                </span>
                <span className="mt-2 block text-sm leading-normal text-pretty text-neutral-950/60 max-md:max-w-[32ch]">
                  {description}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {/* Phones show one step at a time; these step through them. */}
        <div className="mt-4 flex gap-3 md:hidden">
          <StepButton label="Previous step" onClick={() => goTo((active + POINTS.length - 1) % POINTS.length)}>
            <ChevronLeft aria-hidden className="size-4" strokeWidth={2.25} />
          </StepButton>
          <StepButton label="Next step" onClick={() => goTo((active + 1) % POINTS.length)}>
            <ChevronRight aria-hidden className="size-4" strokeWidth={2.25} />
          </StepButton>
        </div>
      </div>
    </section>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full border border-black/9 bg-white text-neutral-950"
    >
      {children}
    </button>
  );
}
