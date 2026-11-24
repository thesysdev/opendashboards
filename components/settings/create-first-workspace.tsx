"use client";

import { useState, useTransition } from "react";

import { createFirstWorkspaceAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

/** The one click that gets someone with no workspace back into the app. */
export function CreateFirstWorkspace({ name }: { name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        className="mt-6 w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createFirstWorkspaceAction();
            if (result && !result.ok) setError(result.error.message);
          })
        }
      >
        {pending ? "Creating…" : `Create "${name}"`}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
