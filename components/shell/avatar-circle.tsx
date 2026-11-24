import { cn } from "@/lib/utils";

export function initialsFor(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export function AvatarCircle({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-700",
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
