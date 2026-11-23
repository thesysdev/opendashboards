import { config } from "@/config";
import { DEV_USER_NAMES } from "@/lib/auth/providers/dev";
import type { Member } from "@/lib/orgs";

import { OrgSwitcher } from "./org-switcher";

/** The signed-in user and the workspace on screen, with the menu to switch. */
export function SidebarUser({ member, compact = false }: { member: Member; compact?: boolean }) {
  const { env, auth } = config();
  return (
    <OrgSwitcher
      email={member.user.email}
      orgs={member.orgs.map(({ id, name }) => ({ id, name }))}
      activeId={member.orgId}
      compact={compact}
      // Only where the dev sign-in is what decides who a request is for.
      devUsers={env === "local" && auth.devUser ? DEV_USER_NAMES : undefined}
    />
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
