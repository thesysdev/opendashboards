"use client";

import { ChevronRightIcon, CodeXmlIcon, LoaderCircleIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { callCount, callTime, type Build, type BuildCall } from "@/lib/dashboards/build-tracker";
import { cn } from "@/lib/utils";

// What a dashboard build is doing, the same in the chat card and over the dashboard.
//
// Collapsed (the default) it's one line: "Thinking", then the call running now ("Tool call
// get_top_products", with its spinner), then "Building dashboard", then how it ended, with the
// build's time on the right. Opened, the calls follow under that line in the same type, newest
// on top, oldest at the bottom, each with its icon and, on the right, how long it took. Whatever
// is running shimmers.
//
// Only real events move it: the model says that it's thinking, never what it thinks, and a build
// that calls no tools goes straight from Thinking to Building dashboard.

export const buildActive = (build: Pick<Build, "phase">) => build.phase === "thinking" || build.phase === "building";

/**
 * A tool's logo by the name the stream reported (components/connections/tool-logo.tsx), or null:
 * the feed then shows the generic wrench. The tool's own name is always shown as reported.
 */
export type LogoFor = (toolName: string) => ReactNode | null;

/** Every icon in the card and the feed is drawn with this stroke, in px, whatever its size. */
export const ICON_STROKE = 1.2;

/** A Lucide icon at `size` px with the shared stroke. */
export function Glyph({ icon: Icon, size, className }: { icon: LucideIcon; size: number; className?: string }) {
  return <Icon aria-hidden size={size} strokeWidth={ICON_STROKE} absoluteStrokeWidth className={cn("shrink-0", className)} />;
}

// One clock for every timer on the page, so the card and the panel never show different seconds.
let second = 0;
const tickers = new Set<() => void>();
let ticking: number | undefined;
function onTick(listener: () => void) {
  tickers.add(listener);
  if (ticking === undefined) {
    second = Math.floor(Date.now() / 1000);
    ticking = window.setInterval(() => {
      second = Math.floor(Date.now() / 1000);
      tickers.forEach((ticker) => ticker());
    }, 250);
  }
  return () => {
    tickers.delete(listener);
    if (!tickers.size) {
      window.clearInterval(ticking);
      ticking = undefined;
    }
  };
}

/** Seconds the build has run, or ran. Null before the page has a clock (the server render). */
function useElapsed(build: Build): number | null {
  const now = useSyncExternalStore(
    onTick,
    () => second,
    () => 0,
  );
  const end = build.endedAt ? build.endedAt / 1000 : now;
  return end ? Math.max(0, Math.floor(end - build.startedAt / 1000)) : null;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "44s", or "1m 12s". */
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);

/** A call's time: "503ms", "1.3s", "1m 4s", the same style as the build's "1m 19s". */
const callDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : duration(Math.round(ms / 1000));

/** "7 tool calls, 4 scripts". Empty for a build that made none. */
function callSummary(build: Build): string {
  const tools = build.calls.filter((call) => call.kind === "tool").reduce((sum, call) => sum + call.count, 0);
  const scripts = callCount(build) - tools;
  const part = (count: number, word: string) => (count ? `${count} ${word}${count === 1 ? "" : "s"}` : "");
  return [part(tools, "tool call"), part(scripts, "script")].filter(Boolean).join(", ");
}

/** A call runs while its round is the latest and the build hasn't started writing. */
const running = (build: Build, call: BuildCall) => build.phase === "thinking" && call.round === build.rounds;

const callLabel = (call: BuildCall) => (call.kind === "script" ? "Script" : "Tool call");

/** Why it failed, without repeating the label: "Couldn't build the dashboard: a source…" → "A source…". */
function reason(error: string | undefined): string | undefined {
  const rest = error?.replace(/^Couldn['’]t (build|update|change) (the|this) dashboard[:.]?\s*/i, "").trim();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : undefined;
}

/** Newest first: the calls of the latest round on top, the first call at the bottom. */
const newestFirst = (build: Build) => [...build.calls].reverse();

/** The line: the call running now, or the build's phase. */
type Status = { label: string; detail?: string; tone?: "danger"; call?: BuildCall; others?: number };

function status(build: Build): Status {
  const summary = callSummary(build) || undefined;
  switch (build.phase) {
    case "thinking": {
      const live = newestFirst(build).filter((call) => running(build, call));
      if (!live.length) return { label: "Thinking" };
      return { label: callLabel(live[0]), detail: live[0].name, call: live[0], others: live.length - 1 };
    }
    case "building":
      return { label: build.edit ? "Updating dashboard" : "Building dashboard", detail: summary };
    case "ready":
      return { label: build.edit ? "Updated" : "Ready", detail: summary };
    case "stopped":
      return { label: "Stopped", detail: summary };
    case "failed":
      return { label: build.edit ? "Couldn't update" : "Couldn't build", detail: summary, tone: "danger" };
  }
}

function Timer({ build }: { build: Build }) {
  const elapsed = useElapsed(build);
  if (elapsed === null) return null;
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {buildActive(build) ? clock(elapsed) : duration(elapsed)}
    </span>
  );
}

/** A call's icon: a spinner while it runs, then the connector's logo, or the wrench (a script: code). */
function CallIcon({ live, call, logoFor }: { live: boolean; call: BuildCall; logoFor?: LogoFor }) {
  if (live) return <Glyph icon={LoaderCircleIcon} size={16} className="animate-spin text-foreground motion-reduce:animate-none" />;
  const logo = call.kind === "tool" ? logoFor?.(call.name) : null;
  if (logo) return <span className="flex size-4 shrink-0 items-center justify-center">{logo}</span>;
  return <Glyph icon={call.kind === "tool" ? WrenchIcon : CodeXmlIcon} size={16} className="text-muted-foreground" />;
}

/**
 * The words of a line: the label at 500 and, after it, the detail. Running, the label is ink and
 * both shimmer, a light band passing over them.
 */
function Words({ label, detail, live, tone, extra }: { label: string; detail?: string; live: boolean; tone?: "danger"; extra?: ReactNode }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm", live && "feed-shimmer")}>
      <span
        className={cn(
          "shrink-0 font-medium whitespace-nowrap",
          tone === "danger" ? "text-destructive" : live ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {detail && (
        <span className="min-w-0 truncate text-muted-foreground" title={detail}>
          {detail}
        </span>
      )}
      {extra}
    </span>
  );
}

/** The first line, which opens and closes the rest. */
function Trigger({ build, open, onToggle, logoFor }: { build: Build; open: boolean; onToggle: () => void; logoFor?: LogoFor }) {
  const { label, detail, tone, call, others } = status(build);
  const active = buildActive(build);
  const canOpen = build.calls.length > 0;
  // Collapsed, "+2" says more are running; opened, they're listed under it.
  const more = !open && others ? <span className="shrink-0 text-muted-foreground tabular-nums">+{others}</span> : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canOpen}
      aria-expanded={canOpen ? open : undefined}
      className="flex h-5 w-full min-w-0 items-center gap-1 rounded-sm text-left select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default"
    >
      <span className="flex min-w-0 items-center gap-2">
        {call && <CallIcon live call={call} logoFor={logoFor} />}
        <Words label={label} detail={detail} live={active} tone={tone} extra={more} />
      </span>
      {canOpen && (
        <Glyph
          icon={ChevronRightIcon}
          size={12}
          className={cn(
            "text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      )}
      {/* Its own flex box, so the 12px time is centred on the 20px line, not set on the label's baseline. */}
      <span className="ml-auto flex shrink-0 items-center pl-3">
        <Timer build={build} />
      </span>
    </button>
  );
}

/** One call under the line: icon, "Tool call", its name, and on the right what it took. */
function CallRow({ build, call, logoFor }: { build: Build; call: BuildCall; logoFor?: LogoFor }) {
  const live = running(build, call);
  const ms = live ? undefined : callTime(build, call);
  const repeat = call.count > 1 ? <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">×{call.count}</span> : null;
  return (
    <li className="flex h-5 items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <span className="flex min-w-0 items-center gap-2">
        <CallIcon live={live} call={call} logoFor={logoFor} />
        <Words label={callLabel(call)} detail={call.name} live={live} extra={repeat} />
      </span>
      <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
        {ms !== undefined ? callDuration(ms) : ""}
      </span>
    </li>
  );
}

/** Children at their natural height, with changes to it eased, so opening and growing don't jump. */
function SmoothHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    setHeight(element.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={height === null ? undefined : { height }}
    >
      {/* `flow-root` keeps a child's top margin inside the measured box. */}
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}

/** The line and, once opened, the calls under it: collapsed by default. */
function Feed({ build, logoFor }: { build: Build; logoFor?: LogoFor }) {
  const [open, setOpen] = useState(false);
  const show = open && build.calls.length > 0;
  const why = build.phase === "failed" ? reason(build.error) : undefined;
  // The call on the line isn't listed again under it.
  const onLine = status(build).call;
  const rows = newestFirst(build).filter((call) => call !== onLine);
  return (
    <div>
      <Trigger build={build} open={show} onToggle={() => setOpen((value) => !value)} logoFor={logoFor} />
      {why && <p className="pt-1 text-xs break-words text-muted-foreground">{why}</p>}
      <SmoothHeight>
        {show && rows.length > 0 && (
          <ul className="flex max-h-[18.75rem] flex-col gap-2.5 overflow-y-auto pt-2.5" aria-label="Calls, newest first">
            {rows.map((call) => (
              <CallRow key={`${call.kind}:${call.name}`} build={build} call={call} logoFor={logoFor} />
            ))}
          </ul>
        )}
      </SmoothHeight>
    </div>
  );
}

/** The feed inside the chat card, under its title. */
export function BuildFeedCard({ build, logoFor }: { build: Build; logoFor?: LogoFor }) {
  return <Feed build={build} logoFor={logoFor} />;
}

/**
 * The feed over the dashboard area: the same line in a small floating card, which opens to the
 * same calls. It hangs from a fixed top edge and grows downward, so nothing above it moves.
 */
export function BuildFeedPanel({ build, logoFor, className }: { build: Build; logoFor?: LogoFor; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // 10px above and below; 15px (1.5×) on the right, where the time sits.
        "pointer-events-auto w-[min(26rem,calc(100%-2rem))] rounded-xl border bg-background/95 py-2.5 pr-[15px] pl-3 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur",
        className,
      )}
    >
      <Feed build={build} logoFor={logoFor} />
      {build.phase === "stopped" && (
        <p className="pt-1 text-xs text-muted-foreground">
          Stopped before the dashboard was written. Send the message again to build it.
        </p>
      )}
    </div>
  );
}

/** How a card from the chat's history ended, when there's no build to follow: a dot and a word. */
export type SettledStatus = { tone: "live" | "busy" | "error" | "idle"; label: string };

/**
 * The top of the chat card: the dashboard's title, on its own. Without a `build` to follow
 * (a card from the chat's history), one line under it says how the call ended; with one,
 * BuildFeedCard below carries the status.
 */
export function BuildCardHeader({ title, build, settled }: { title: string; edit?: boolean; build?: Build; settled?: SettledStatus }) {
  return (
    <div className={cn("px-4 pt-3.5", build ? "pb-2.5" : "pb-3.5")}>
      <p className="truncate text-sm font-semibold tracking-[-0.005em]" title={title}>
        {title}
      </p>
      {!build && settled && <SettledStatusLine {...settled} />}
    </div>
  );
}

function SettledStatusLine({ tone, label }: SettledStatus) {
  return (
    <span className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          tone === "live" && "bg-emerald-500",
          tone === "busy" && "animate-pulse bg-amber-500 motion-reduce:animate-none",
          tone === "error" && "bg-destructive",
          tone === "idle" && "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}
