"use client";

import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { startSignInAction } from "@/app/(app)/connections/actions";
import { Button } from "@/components/ui/button";
import { useWorkspaceId } from "@/lib/apps/use-workspace";

/**
 * Why one of the app's sign-ins keeps its data from loading for the reader:
 * - expired: the sign-in it runs with is theirs, and it expired.
 * - notSignedIn: it requires sign-in, and they haven't signed in.
 * - theirsExpired: a shared sign-in someone else holds expired. `by` is
 *   their email, or null for a guest, who isn't told who is in the workspace.
 * - nobody: a shared sign-in nobody holds now.
 */
export type SignInProblem = {
  id: string;
  name: string;
  problem: "expired" | "notSignedIn" | "theirsExpired" | "nobody";
  by: string | null;
  /** Whether the reader may sign in to it themselves. */
  canSignIn: boolean;
};

/**
 * Above the dashboard when one of the app's sources signed in with OAuth
 * can't load for the reader: one row per connection, saying what to do.
 * Signing in comes back to this same page.
 */
export function SignInAgainBanner({ problems }: { problems: SignInProblem[] }) {
  const orgId = useWorkspaceId();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  if (!problems.length) return null;

  function signIn(connectionId: string) {
    startTransition(async () => {
      const result = await startSignInAction({ orgId, kind: "connection", connectionId, returnTo: pathname });
      if (result.ok) window.location.assign(result.data.authorizationUrl);
      else toast.error(result.error.message);
    });
  }

  return (
    <div role="alert" className="flex shrink-0 flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      {problems.map((connection) => (
        <div key={connection.id} className="flex items-center gap-3">
          <KeyRoundIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
          <p className="min-w-0 flex-1">
            <Message {...connection} />
          </p>
          {connection.canSignIn && (
            <Button size="sm" variant="outline" className="shrink-0 bg-white" onClick={() => signIn(connection.id)} disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {connection.problem === "notSignedIn" ? "Sign in" : "Sign in again"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function Message({ name, problem, by }: SignInProblem) {
  const source = <span className="font-medium">{name}</span>;
  switch (problem) {
    case "expired":
      return <>Your sign-in to {source} expired, so its data can&apos;t load. Sign in again to see it.</>;
    case "notSignedIn":
      return <>This app uses {source}, which everyone signs in to with their own account. Sign in to see its data.</>;
    case "theirsExpired":
      return by ? (
        <>
          <span className="font-medium">{by}</span>&apos;s sign-in to {source} expired, so its data can&apos;t load. Ask them, or an
          admin, to sign in again.
        </>
      ) : (
        <>The sign-in to {source} expired, so its data can&apos;t load. Ask whoever shared this app with you.</>
      );
    case "nobody":
      return <>Nobody is signed in to {source} now, so its data can&apos;t load. An admin can sign in to it again.</>;
  }
}
