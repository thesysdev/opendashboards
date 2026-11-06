import { cn } from "@/lib/utils";

/** The square tile at the start of a source or connection row: "PH", "PG". */
export function SourceTile({ label, className }: { label: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-neutral-50 text-xs font-bold tracking-tight text-neutral-700",
        className,
      )}
    >
      {label}
    </div>
  );
}
