"use client";

import { ArrowUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { savePendingPrompt } from "@/lib/pending-prompt";

/**
 * The composer a signed-out visitor sees. Sending keeps the prompt in the
 * browser and goes to /apps, where the gateway signs them in; the composer
 * there picks the prompt up again.
 */
export function LandingPrompt({ examples }: { examples: string[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const canSend = prompt.trim().length > 0;

  function send() {
    if (!canSend) return;
    savePendingPrompt(prompt);
    router.push("/apps");
  }

  return (
    <div className="w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-shadow focus-within:border-neutral-300 focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]"
      >
        <label htmlFor="prompt" className="sr-only">
          Describe the dashboard you want
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask OpenDashboards to build a dashboard of weekly signups by plan…"
          maxLength={4000}
          rows={3}
          className="block max-h-72 min-h-28 w-full resize-none bg-transparent px-4 pt-4 text-[0.9375rem] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
          <span className="px-1 text-xs text-muted-foreground">Sign in to build it. Free to use.</span>
          <Button type="submit" size="icon" className="size-8 rounded-full" disabled={!canSend} aria-label="Build it">
            <ArrowUpIcon />
          </Button>
        </div>
      </form>

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
