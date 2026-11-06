"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { ConnectionFormDialog, type SecretMode } from "./connection-form-dialog";

export function AddConnectionButton({ secretMode }: { secretMode: SecretMode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add connection
      </Button>
      <ConnectionFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
        secretMode={secretMode}
      />
    </>
  );
}
