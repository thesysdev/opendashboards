"use client";

import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { startMcpSignInAction } from "@/app/(app)/connections/actions";
import { Button } from "@/components/ui/button";

/**
 * Above the dashboard when one of the app's sources signed in with OAuth has
 * lost its sign-in (expired or revoked): its panels can't load until the user
 * signs in again, as themselves. Signing in comes back to this same page.
 */
export function SignInAgainBanner({
  connections,
  others = [],
  expired = [],
}: {
  connections: { id: string; name: string }[];
  /**
   * Teammates' personal sign-ins this app uses, where the reader has none of
   * their own to that server: queries never run as someone else, so its
   * panels stay empty until they sign in themselves.
   */
  others?: { id: string; name: string }[];
  /**
   * Sign-ins a teammate shared with the workspace that have expired. Only
   * that teammate can sign in again, so this says who to ask. `owner` is
   * null for a guest, who isn't told who is in the workspace.
   */
  expired?: { id: string; name: string; owner: string | null }[];
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  if (!connections.length && !others.length && !expired.length) return null;

  function signIn(connectionId: string, own = true) {
    startTransition(async () => {
      const result = await startMcpSignInAction(own ? { connectionId, returnTo: pathname } : { like: connectionId, returnTo: pathname });
      if (result.ok) window.location.assign(result.data.authorizationUrl);
      else toast.error(result.error.message);
    });
  }

  return (
    <div role="alert" className="flex shrink-0 flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      {connections.map((connection) => (
        <div key={connection.id} className="flex items-center gap-3">
          <KeyRoundIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
          <p className="min-w-0 flex-1">
            Your sign-in to <span className="font-medium">{connection.name}</span> expired, so its data can&apos;t load. Sign in
            again to see it.
          </p>
          <Button size="sm" variant="outline" className="shrink-0 bg-white" onClick={() => signIn(connection.id)} disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            Sign in again
          </Button>
        </div>
      ))}
      {expired.map((connection) => (
        <div key={connection.id} className="flex items-center gap-3">
          <KeyRoundIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
          <p className="min-w-0 flex-1">
            {connection.owner ? (
              <>
                <span className="font-medium">{connection.owner}</span>&apos;s sign-in to{" "}
                <span className="font-medium">{connection.name}</span> expired, so its data can&apos;t load. Ask them to sign in
                again.
              </>
            ) : (
              <>
                The sign-in to <span className="font-medium">{connection.name}</span> expired, so its data can&apos;t load. Ask
                whoever shared this app with you.
              </>
            )}
          </p>
        </div>
      ))}
      {others.map((connection) => (
        <div key={connection.id} className="flex items-center gap-3">
          <KeyRoundIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
          <p className="min-w-0 flex-1">
            This app uses <span className="font-medium">{connection.name}</span> with a personal sign-in. Sign in to see its data
            as yourself.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 bg-white"
            onClick={() => signIn(connection.id, false)}
            disabled={pending}
          >
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            Sign in
          </Button>
        </div>
      ))}
    </div>
  );
}
