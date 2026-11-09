"use client";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { startDemoAppAction } from "@/app/(app)/apps/actions";
import { cn } from "@/lib/utils";

export type DemoPromptDataset = { key: string; name: string; prompts: string[] };

/**
 * "Try it with demo data": starting prompts for people without data of
 * their own. Picking one installs the demo dataset and builds an app on it.
 */
export function DemoPrompts({ datasets }: { datasets: DemoPromptDataset[] }) {
  const [started, setStarted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start(dataset: string, prompt: string) {
    setError(null);
    setStarted(prompt);
    startTransition(async () => {
      // Only returns when it failed; on success it opens the new app.
      const result = await startDemoAppAction({ dataset, prompt });
      if (result && !result.ok) {
        setError(result.error.message);
        setStarted(null);
      }
    });
  }

  return (
    <div className="mt-8">
      <p className="mb-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5" aria-hidden />
        No data yet? Try it with demo data
      </p>
      <ul className="flex flex-col gap-2">
        {datasets.flatMap((dataset) =>
          dataset.prompts.map((prompt) => (
            <li key={`${dataset.key}:${prompt}`}>
              <button
                type="button"
                onClick={() => start(dataset.key, prompt)}
                disabled={pending}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-background px-3.5 py-2.5 text-left text-sm transition-colors",
                  "hover:border-neutral-300 hover:bg-neutral-50/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">{prompt}</span>
                <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-600">
                  {dataset.name}
                </span>
                {pending && started === prompt && (
                  <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                )}
              </button>
            </li>
          )),
        )}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
