"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { SourceOption } from "@/lib/sources/catalog";
import type { McpServiceKey } from "@/lib/sources/mcp/services";

import { PostHogFormDialog, type SecretMode } from "./connection-form-dialog";
import { PostgresFormDialog } from "./postgres-form-dialog";
import { SourceFormDialog } from "./source-form-dialog";

export function AddConnectionButton({
  source,
  secretMode,
}: {
  source: Pick<SourceOption, "type" | "flavor">;
  secretMode: SecretMode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add connection
      </Button>
      <ConnectDialog source={source} open={open} onOpenChange={setOpen} secretMode={secretMode} />
    </>
  );
}

/** The connect dialog for a source, or for a known MCP server (a preset on the MCP form). */
export function ConnectDialog({
  source,
  service,
  open,
  onOpenChange,
  secretMode,
  onCreated,
}: {
  source: Pick<SourceOption, "type" | "flavor">;
  service?: McpServiceKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretMode: SecretMode;
  onCreated?: (id: string) => void;
}) {
  const dialog = { mode: "create" as const, open, onOpenChange, secretMode, onCreated };
  if (source.type === "postgres") return <PostgresFormDialog {...dialog} flavor={source.flavor} />;
  if (source.type === "posthog") return <PostHogFormDialog {...dialog} />;
  // Keyed by preset, so switching between servers starts from a fresh form.
  return <SourceFormDialog key={service ?? source.type} {...dialog} type={source.type} service={service} />;
}
