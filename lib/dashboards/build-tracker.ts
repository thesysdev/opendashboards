"use client";

import type { ArtifactBuildStep } from "@openuidev/react-headless";
import { useSyncExternalStore } from "react";

/*
 * One record per dashboard build, shared by the Build chat's card and the dashboard
 * area, so both tell the same story from the same facts: Thinking → the tools it
 * calls, by name → Building dashboard → how it ended. A build is the tool call that
 * makes it (create_dashboard or edit_dashboard); once OpenUI Cloud gives the
 * dashboard an id, the build is found by that too.
 *
 * The renderer reports only the latest step of a build, so the list of calls is kept
 * here. Whoever is on screen reports what it sees (the chat its tool call, the card
 * and the dashboard area the dashboard's stream); a step both of them see counts once.
 */

export type BuildPhase = "thinking" | "building" | "ready" | "stopped" | "failed";

/** A data tool the build called, or a script it saved, by the name the stream reported. */
export type BuildCall = {
  name: string;
  kind: "tool" | "script";
  /** Times it was called in the whole build. */
  count: number;
  /** The round it was last called in, from 1. The latest round is the one still running. */
  round: number;
};

export type Build = {
  /** The tool call that makes the dashboard. */
  key: string;
  artifactId?: string;
  /** The version this build writes, from OpenUI Cloud's first response. */
  version?: string;
  edit: boolean;
  phase: BuildPhase;
  calls: BuildCall[];
  /** Rounds of calls seen so far. */
  rounds: number;
  /** When each round of calls was seen (ms), by round: what each call took is the time to the next. */
  roundAt: number[];
  /** When the dashboard started being written (ms). */
  writingAt?: number;
  startedAt: number;
  endedAt?: number;
  /** Why it failed, in words for the user. */
  error?: string;
};

const builds = new Map<string, Build>();
const byArtifact = new Map<string, string>();
const seenSteps = new WeakSet<ArtifactBuildStep>();
const listeners = new Set<() => void>();

const settled = (phase: BuildPhase) => phase === "ready" || phase === "stopped" || phase === "failed";

function set(build: Build) {
  builds.set(build.key, build);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chat's side: a create or edit call started, got its dashboard's id, or ended. */
export function reportCall(
  key: string,
  call: {
    edit: boolean;
    artifactId?: string;
    version?: string;
    /** Set once the call is over. */
    outcome?: "ready" | "stopped" | "failed";
    error?: string;
  },
) {
  let build = builds.get(key);
  if (!build) {
    build = { key, edit: call.edit, phase: "thinking", calls: [], rounds: 0, roundAt: [], startedAt: Date.now() };
    set(build);
  }
  if (call.artifactId && (build.artifactId !== call.artifactId || (call.version && build.version !== call.version))) {
    byArtifact.set(call.artifactId, key);
    build = { ...build, artifactId: call.artifactId, version: call.version ?? build.version };
    set(build);
  }
  if (call.outcome && !settled(build.phase)) {
    set({ ...build, phase: call.outcome, endedAt: Date.now(), error: call.error });
  }
}

/**
 * The stream's side, from the card or the dashboard area: the dashboard's latest
 * step, whether it has content, and whether it's still streaming.
 */
export function reportStream(
  artifactId: string,
  stream: {
    step?: ArtifactBuildStep;
    hasContent: boolean;
    isStreaming: boolean;
    error?: string | null;
  },
) {
  const key = byArtifact.get(artifactId);
  let build = key ? builds.get(key) : undefined;
  if (!build || settled(build.phase)) return;

  const { step } = stream;
  if (step && !seenSteps.has(step) && build.phase === "thinking") {
    seenSteps.add(step);
    const round = build.rounds + 1;
    const calls = [...build.calls];
    // A name seen before (this round or an earlier one) stays one row: it moves to the latest
    // round, the newest end of the list, and counts the call.
    const add = (name: string, kind: BuildCall["kind"]) => {
      const index = calls.findIndex((call) => call.kind === kind && call.name === name);
      const count = index >= 0 ? calls[index].count + 1 : 1;
      if (index >= 0) calls.splice(index, 1);
      calls.push({ name, kind, count, round });
    };
    step.tools.forEach((name) => add(name, "tool"));
    step.scripts.forEach((name) => add(name, "script"));
    build = { ...build, calls, rounds: round, roundAt: [...build.roundAt, Date.now()] };
    set(build);
  }
  if (stream.error) {
    set({ ...build, phase: "failed", endedAt: Date.now(), error: stream.error });
    return;
  }
  // Writing has started. A new dashboard has content from then on. An edit keeps showing the
  // version before it, so there the sign is the step clearing while it still streams; an edit
  // that called nothing gives no sign, and stays "Thinking" until it's done.
  const writing = build.edit ? build.rounds > 0 && !step && stream.isStreaming : stream.hasContent;
  if (writing && build.phase === "thinking") {
    build = { ...build, phase: "building", writingAt: Date.now() };
    set(build);
  }
  // The stream ended cleanly after writing: saved. The tool call's last result says so too.
  if (build.phase === "building" && !stream.isStreaming) {
    set({ ...build, phase: "ready", endedAt: Date.now() });
  }
}

/**
 * The build to show: by its tool call, or else the latest build of a dashboard.
 * Undefined for a dashboard nothing built in this session.
 */
export function useBuild(key?: string | null, artifactId?: string | null): Build | undefined {
  const read = () => {
    // A dashboard's latest build first: an edit of the one on screen is a later tool call's.
    const latest = artifactId ? byArtifact.get(artifactId) : undefined;
    return (latest ? builds.get(latest) : undefined) ?? (key ? builds.get(key) : undefined);
  };
  return useSyncExternalStore(subscribe, read, () => undefined);
}

/** How many calls a build made, counting repeats. */
export const callCount = (build: Build) => build.calls.reduce((sum, call) => sum + call.count, 0);

/**
 * How long a call took, in ms: from its round to the next round, or to the writing, or to the end.
 * Undefined while its round is still running.
 */
export function callTime(build: Build, call: BuildCall): number | undefined {
  const from = build.roundAt[call.round - 1];
  if (from === undefined) return undefined;
  const to = build.roundAt[call.round] ?? build.writingAt ?? build.endedAt;
  return to === undefined ? undefined : Math.max(0, to - from);
}
