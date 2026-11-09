import { LogOut } from "lucide-react";

import { secrets } from "@/config";
import { requireUser } from "@/lib/auth/user";

import { AvatarCircle } from "./user-avatar";

/** The signed-in user at the bottom of the sidebar. Reads the request, so it renders behind Suspense. */
export async function SidebarUser() {
  const user = await requireUser();
  const name = user.email ?? user.id;
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5" aria-label={`Signed in as ${name}`}>
      <AvatarCircle userId={name} className="size-7" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80" title={name}>
        {name}
      </span>
      {secrets.supabaseUrl() && (
        <form action="/auth/signout" method="post">
          <button type="submit" aria-label="Sign out" className="flex rounded p-1 text-foreground/60 hover:text-foreground">
            <LogOut className="size-4" />
          </button>
        </form>
      )}
    </div>
  );
}

export function SidebarUserFallback() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5" aria-hidden>
      <span className="size-7 rounded-full bg-neutral-200" />
      <span className="h-3 w-20 rounded bg-neutral-200" />
    </div>
  );
}
