import { cn } from "@/lib/utils";

/** The square icon tile at the start of a source or connection row. */
export function PostHogTile({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-neutral-50 text-xs font-bold tracking-tight text-neutral-700",
        className,
      )}
    >
      PH
    </div>
  );
}
