import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/shell/brand";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { SidebarUser, SidebarUserFallback } from "@/components/shell/sidebar-user";
import { UserAvatar, UserAvatarFallback } from "@/components/shell/user-avatar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh bg-neutral-50">
      {/* md and up: the sidebar holds the brand, the nav, and the user. */}
      <aside className="hidden w-56 shrink-0 flex-col px-3 py-3 md:flex">
        <HomeLink className="mb-3 flex h-9 items-center px-2.5" />
        <SidebarNav />
        <div className="mt-auto">
          <Suspense fallback={<SidebarUserFallback />}>
            <SidebarUser />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below md the sidebar is hidden; this bar replaces it. */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 md:hidden">
          <div className="flex items-center gap-2">
            <MobileNav />
            <HomeLink />
          </div>
          <Suspense fallback={<UserAvatarFallback />}>
            <UserAvatar />
          </Suspense>
        </header>

        <main className="mx-2 mb-2 min-h-0 flex-1 overflow-y-auto rounded-xl border bg-background md:my-2 md:ml-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function HomeLink({ className }: { className?: string }) {
  return (
    <Link
      href="/connections"
      aria-label="Prism home"
      className={`rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${className ?? ""}`}
    >
      <Brand />
    </Link>
  );
}
