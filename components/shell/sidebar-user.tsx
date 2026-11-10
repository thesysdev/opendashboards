import { requireUser } from "@/lib/auth/user";

import { AvatarCircle } from "./user-avatar";

/** The signed-in user at the bottom of the sidebar. Reads the request, so it renders behind Suspense. */
export async function SidebarUser() {
  const user = await requireUser();
  const name = user.email ?? user.id;
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5" aria-label={`Signed in as ${name}`}>
      <AvatarCircle name={name} className="size-7" />
      <span className="min-w-0 truncate text-sm text-foreground/80" title={name}>
        {name}
      </span>
    </div>
  );
}

export function SidebarUserFallback() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5" aria-hidden>
      <span className="size-7 rounded-full bg-neutral-200" />
      <span className="h-3 w-20 rounded bg-neutral-200" />
    </div>
  );
}
