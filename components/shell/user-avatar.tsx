import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getUser } from "@/lib/auth/user";
import { cn } from "@/lib/utils";

import { SignInLink } from "./sign-in-link";

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

/** The compact avatar for the mobile top bar, or the way to sign in. Reads the request, so it renders behind Suspense. */
export async function UserAvatar() {
  const user = await getUser();
  if (!user) return <SignInLink />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={`Signed in as ${user.email}`} className="rounded-full">
          <AvatarCircle name={user.email} />
        </span>
      </TooltipTrigger>
      <TooltipContent>Signed in as {user.email}</TooltipContent>
    </Tooltip>
  );
}

export function UserAvatarFallback() {
  return <span className="size-8 rounded-full bg-neutral-200" aria-hidden />;
}
