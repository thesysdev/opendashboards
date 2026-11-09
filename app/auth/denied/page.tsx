import type { Metadata } from "next";

import { Brand } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access", robots: { index: false, follow: false } };

export default function DeniedPage() {
  return (
    <main className="flex h-dvh items-center justify-center bg-neutral-50 px-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-background p-6">
        <Brand />
        <h1 className="mt-2 text-lg font-medium">You don&apos;t have access yet</h1>
        <p className="text-sm text-muted-foreground">Prism is invite-only for now. Sign in with an invited account, or ask for an invite.</p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" size="lg" className="w-full">
            Use a different account
          </Button>
        </form>
      </div>
    </main>
  );
}
