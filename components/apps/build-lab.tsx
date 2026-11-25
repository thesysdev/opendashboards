"use client";

import { useArtifactStorage, useThread } from "@openuidev/react-headless";
import { ChevronDownIcon, FlaskConicalIcon, PlayIcon, SkipForwardIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { lab, SCENARIOS } from "@/lib/lab/controller";
import { cn } from "@/lib/utils";

import { useSetCreatingDashboard } from "./app-workspace";

/*
 * The build lab's panel (development only, NEXT_PUBLIC_BUILD_LAB=1). It replays a dashboard
 * build through the real chat and the real dashboard area, on demand and step by step.
 * Nothing here ships: see lib/lab/controller.ts.
 */

const useLab = () => useSyncExternalStore(lab.subscribe, lab.getState, lab.getState);

export function BuildLab({
  viewingId,
  fallbackId,
}: {
  /** The dashboard on screen, by its artifact id: the one an edit changes, and the one a build replays. */
  viewingId: string | null;
  /** The app's first dashboard, replayed when none is on screen. */
  fallbackId: string | null;
}) {
  const state = useLab();
  const storage = useArtifactStorage();
  const setCreating = useSetCreatingDashboard();
  const processMessage = useThread((s) => s.processMessage);
  const cancel = useThread((s) => s.cancelMessage);
  const isRunning = useThread((s) => s.isRunning);
  // Open from the start when a link names a scenario (?lab=…): see below.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("lab"));
  // In the browser only: the panel is drawn into the page's body.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const source = viewingId ?? fallbackId;

  // A link can start a scenario: ?lab=<scenario id>, with &step=1 to go step by step and
  // &stopAfter=<ms> to press Stop that long after it starts (the Stopped state).
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !mounted || !source || !storage) return;
    const params = new URLSearchParams(window.location.search);
    const chosen = SCENARIOS.find((candidate) => candidate.id === params.get("lab"));
    if (!chosen) return;
    // An edit changes the dashboard on screen: wait until it's there.
    if (chosen.kind === "edit" && !viewingId) return;
    linked.current = true;
    lab.setScenario(chosen.id);
    if (params.get("step") === "1") lab.setAuto(false);
    const stopAfter = Number(params.get("stopAfter"));
    const timers: number[] = [];
    // After the page has settled, so the replay isn't cut short by its first loads.
    timers.push(
      window.setTimeout(async () => {
        lab.stop();
        setCreating(null);
        if (!(await lab.prepare(source, storage))) return;
        void processMessage({ role: "user", content: chosen.prompt });
        if (stopAfter > 0)
          timers.push(
            window.setTimeout(() => {
              lab.stop();
              cancel();
            }, stopAfter),
          );
      }, 2500),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [mounted, source, viewingId, storage, setCreating, processMessage, cancel]);

  if (!mounted) return null;

  const scenario = SCENARIOS.find((candidate) => candidate.id === state.scenario) ?? SCENARIOS[0];

  async function play() {
    if (!source || !storage) return;
    if (isRunning) cancel();
    lab.stop();
    // Back to the page's own dashboard: a replayed new dashboard from the last run leaves the screen.
    setCreating(null);
    // Let the stopped turn settle before the next one starts.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!(await lab.prepare(source, storage))) return;
    void processMessage({ role: "user", content: scenario.prompt });
  }

  function stop() {
    lab.stop();
    if (isRunning) cancel();
  }

  return createPortal(
    !open ? (
      <button
        type="button"
        data-build-lab
        onClick={() => setOpen(true)}
        className="fixed bottom-36 left-3 z-50 flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-lg"
      >
        <FlaskConicalIcon className="size-3.5" aria-hidden />
        Build lab
      </button>
    ) : (
      <section
        aria-label="Build lab"
        data-build-lab
        className="fixed bottom-36 left-3 z-50 flex w-[236px] flex-col overflow-hidden rounded-xl border bg-background text-xs shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <FlaskConicalIcon className="size-3.5" aria-hidden />
          <span className="font-semibold">Build lab</span>
          <span className="text-muted-foreground">replay</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Collapse the build lab" className="ml-auto rounded p-0.5 hover:bg-muted">
            <ChevronDownIcon className="size-3.5" aria-hidden />
          </button>
        </header>
        <div className="flex flex-col gap-2.5 p-3">
          {!source ? (
            <p className="text-muted-foreground">The lab replays one of this app&apos;s dashboards. Build one first: ask for a dashboard in the chat.</p>
          ) : (
            <>
              <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Scenario">
                {SCENARIOS.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={candidate.id === state.scenario}
                    data-scenario={candidate.id}
                    onClick={() => lab.setScenario(candidate.id)}
                    className={cn("rounded-md px-2 py-1 text-left hover:bg-muted", candidate.id === state.scenario && "bg-muted")}
                  >
                    <span className="block font-medium">{candidate.label}</span>
                    <span className="block text-muted-foreground">{candidate.hint}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <LabButton onClick={() => void play()} primary label="Play">
                  <PlayIcon className="size-3" aria-hidden />
                </LabButton>
                <LabButton onClick={() => lab.next()} disabled={!state.running || state.auto} label="Next">
                  <SkipForwardIcon className="size-3" aria-hidden />
                </LabButton>
                <LabButton onClick={stop} disabled={!state.running && !isRunning} label="Stop">
                  <SquareIcon className="size-3" aria-hidden />
                </LabButton>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!state.auto} onChange={(event) => lab.setAuto(!event.target.checked)} />
                  Step by step
                </label>
                <label className="ml-auto flex items-center gap-1.5">
                  Speed
                  <select value={state.speed} onChange={(event) => lab.setSpeed(Number(event.target.value))} className="rounded border bg-background px-1 py-0.5">
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </label>
              </div>
              <p className="min-h-8 text-muted-foreground" aria-live="polite">
                {state.error ?? (state.stage ? `${state.running ? "Now" : "Ended"}: ${state.stage}` : "Replays the dashboard on screen. Its data loads for real.")}
              </p>
            </>
          )}
        </div>
      </section>
    ),
    document.body,
  );
}

function LabButton({
  onClick,
  disabled,
  primary,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 font-medium disabled:opacity-40",
        primary ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
      )}
    >
      {children}
      {label}
    </button>
  );
}
