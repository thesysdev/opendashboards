import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Brand } from "@/components/shell/brand";
import { CreateFirstWorkspace } from "@/components/settings/create-first-workspace";
import { lastMember, requireKnownUser } from "@/lib/orgs";
import { defaultWorkspaceName } from "@/lib/orgs/service";

export const metadata: Metadata = { title: "Create your workspace", robots: { index: false, follow: false } };

/**
 * Where someone in no workspace lands (removed from their only one, or they
 * left it). Everything in the app belongs to a workspace, so this is all they
 * can do until they have one: create it, in one click.
 */
export default function WelcomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm rounded-xl border bg-background p-8 text-center">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <NoWorkspace />
        </Suspense>
      </div>
    </main>
  );
}

async function NoWorkspace() {
  // Anyone who already has a workspace has no business here.
  if (await lastMember()) redirect("/apps");
  const user = await requireKnownUser();
  return (
    <>
      <h1 className="text-xl font-bold tracking-tight">Create your workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You&apos;re not in a workspace right now. Apps and data connections live in one, so create yours to carry on.
      </p>
      <CreateFirstWorkspace name={defaultWorkspaceName(user.email)} />
      <p className="mt-4 text-xs text-muted-foreground">Signed in as {user.email}</p>
    </>
  );
}
