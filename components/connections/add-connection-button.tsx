"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ConnectionType } from "@/lib/sources/catalog";

import { PostHogFormDialog, type SecretMode } from "./connection-form-dialog";
import { PostgresFormDialog } from "./postgres-form-dialog";

export function AddConnectionButton({
  source,
  secretMode,
}: {
  source: ConnectionType;
  secretMode: SecretMode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = { mode: "create" as const, open, onOpenChange: setOpen, secretMode };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add connection
      </Button>
      {source === "postgres" ? (
        <PostgresFormDialog {...dialog} />
      ) : (
        <PostHogFormDialog {...dialog} />
      )}
    </>
  );
}
