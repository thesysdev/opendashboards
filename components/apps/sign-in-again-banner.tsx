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
export function SignInAgainBanner({ connections }: { connections: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  if (!connections.length) return null;

  function signIn(connectionId: string) {
    startTransition(async () => {
      const result = await startMcpSignInAction({ connectionId, returnTo: pathname });
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
    </div>
  );
}
