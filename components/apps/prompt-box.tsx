"use client";

import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { createAppAction } from "@/app/(app)/apps/actions";
import { Button } from "@/components/ui/button";
import { clearPendingPrompt, savePendingPrompt, usePendingPrompt } from "@/lib/pending-prompt";
import { SIGN_IN_NEXT, SIGN_IN_PATH } from "@/lib/site";
import { cn } from "@/lib/utils";

import { DataSourcePicker, type PickerConnection } from "./data-source-picker";

/**
 * The "What do you want to build?" composer. Sending creates an app with the
 * prompt and the chosen data sources, then opens it.
 *
 * A signed-out visitor has no data sources yet: sending keeps their prompt in
 * the browser and takes them to sign in, and the composer they come back to
 * starts with it.
 */
export function PromptBox({
  connections,
  initiallySelected,
  autoFocus,
  signedOut = false,
  examples = [],
}: {
  connections: PickerConnection[];
  /** The sources ticked at first; all of them when left out. */
  initiallySelected?: string[];
  autoFocus?: boolean;
  signedOut?: boolean;
  /** Prompts to start from, shown under the composer. */
  examples?: string[];
}) {
  // Starts with what they wrote on the landing page before signing in, if anything.
  const saved = usePendingPrompt();
  const [edited, setPrompt] = useState<string | null>(null);
  const prompt = edited ?? saved ?? "";
  // Track what was unticked rather than what's ticked, so a newly added
  // source starts out selected.
  const [unticked, setUnticked] = useState<Set<string>>(
    () =>
      new Set(
        initiallySelected
          ? connections.filter((c) => !initiallySelected.includes(c.id)).map((c) => c.id)
          : [],
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = new Set(connections.filter((c) => !unticked.has(c.id)).map((c) => c.id));
  const canSend = prompt.trim().length > 0 && (signedOut || selected.size > 0) && !pending;

  function toggle(id: string, checked: boolean) {
    setUnticked((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  function send() {
    if (!canSend) return;
    setError(null);
    // Keep the text on screen once the saved copy is gone.
    setPrompt(prompt);
    clearPendingPrompt();
    startTransition(async () => {
      // Only returns when creating failed; on success it navigates to the app.
      const result = await createAppAction({ prompt, connectionIds: [...selected] });
      if (result && !result.ok) setError(result.error.message);
    });
  }

  const hint = signedOut
    ? null
    : connections.length === 0
      ? "Add a data source to start building."
      : selected.size === 0
        ? "Choose at least one data source."
        : null;

  return (
    <div className="w-full">
      <form
        // Signed out, the form itself goes to the gateway's sign-in page. The
        // prompt has no name, so it stays out of the URL.
        action={signedOut ? SIGN_IN_PATH : undefined}
        method="get"
        onSubmit={(event) => {
          if (signedOut && canSend) {
            savePendingPrompt(prompt);
            return;
          }
          event.preventDefault();
          send();
        }}
        className={cn(
          "rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-shadow",
          "focus-within:border-neutral-300 focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]",
        )}
      >
        {signedOut && <input type="hidden" name="next" value={SIGN_IN_NEXT} />}
        <label htmlFor="prompt" className="sr-only">
          Describe the dashboard you want
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask OpenDashboards to build a dashboard of weekly signups by plan…"
          disabled={pending}
          autoFocus={autoFocus}
          maxLength={4000}
          rows={3}
          className="block max-h-72 min-h-28 w-full resize-none bg-transparent px-4 pt-4 text-[0.9375rem] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
          {signedOut ? (
            <span className="px-1 text-xs text-muted-foreground">Sign in to build it. Free to use.</span>
          ) : (
            <DataSourcePicker
              connections={connections}
              selected={selected}
              onToggle={toggle}
              disabled={pending}
            />
          )}
          <Button
            type="submit"
            size="icon"
            className="size-8 rounded-full"
            disabled={!canSend}
            aria-label="Build it"
            title={hint ?? undefined}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
          </Button>
        </div>
      </form>

      {(error || (hint && prompt.trim())) && (
        <p
          role={error ? "alert" : undefined}
          className={cn("mt-3 text-center text-sm", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ?? hint}
        </p>
      )}

      {examples.length > 0 && (
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-neutral-300 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
