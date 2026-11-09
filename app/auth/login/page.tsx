import type { Metadata } from "next";
import { Suspense } from "react";

import { Brand } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";
import { safeNext, SIGN_IN_PROVIDERS } from "@/lib/auth/site";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

async function SignInOptions({ searchParams }: { searchParams: PageProps<"/auth/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  return (
    <>
      {params.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          We couldn&apos;t sign you in with that account. Try again, or use another option.
        </p>
      )}
      {SIGN_IN_PROVIDERS.map((provider) => (
        <Button key={provider.id} variant="outline" size="lg" asChild>
          {/* A full navigation: this route redirects away to the provider. */}
          <a href={`/auth/oauth?provider=${provider.id}&next=${encodeURIComponent(next)}`}>{provider.label}</a>
        </Button>
      ))}
    </>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  return (
    <main className="flex h-dvh items-center justify-center bg-neutral-50 px-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-background p-6">
        <Brand />
        <h1 className="mt-2 text-lg font-medium">Sign in to Prism</h1>
        <Suspense fallback={null}>
          <SignInOptions searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
