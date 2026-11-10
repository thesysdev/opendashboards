import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requireUser } from "@/lib/auth/user";
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

/** The compact avatar for the mobile top bar. Reads the request, so it renders behind Suspense. */
export async function UserAvatar() {
  const user = await requireUser();
  const name = user.email ?? user.id;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={`Signed in as ${name}`} className="rounded-full">
          <AvatarCircle name={name} />
        </span>
      </TooltipTrigger>
      <TooltipContent>Signed in as {name}</TooltipContent>
    </Tooltip>
  );
}

export function UserAvatarFallback() {
  return <span className="size-8 rounded-full bg-neutral-200" aria-hidden />;
}
