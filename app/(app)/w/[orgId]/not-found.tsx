import { LockIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { requireKnownUser } from "@/lib/orgs";

/**
 * What someone sees at a link to an app or dashboard they can't open: most
 * often a link they were sent, opened with a different account than the one
 * it was shared with. An app that doesn't exist and one they aren't let into
 * look the same, so the page says what to check without confirming either.
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-background">
        <LockIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="text-xl font-bold tracking-tight">You can&apos;t open this</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        It hasn&apos;t been shared with the account you&apos;re signed in with, or it no longer exists.
      </p>
      <Suspense fallback={null}>
        <SignedInAs />
      </Suspense>
      <Button asChild variant="outline" size="sm" className="mt-6">
        <Link href="/apps">Go to your apps</Link>
      </Button>
    </div>
  );
}

/** Which account they're on: a link shared with another address is the usual reason. Reads the request, so it streams in. */
async function SignedInAs() {
  const user = await requireKnownUser();
  return (
    <p className="mt-4 max-w-md text-sm text-muted-foreground">
      You&apos;re signed in as <span className="font-medium text-foreground">{user.email}</span>. If someone sent you this link,
      ask them to share it with that address.
    </p>
  );
}
