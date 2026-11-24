"use client";

import { EllipsisIcon, KeyRoundIcon, Loader2Icon, LogInIcon, LogOutIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteConnectionAction,
  renameConnectionAction,
  retestConnectionAction,
  signOutOfConnectionAction,
  startMcpSignInAction,
} from "@/app/(app)/connections/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ConnectionKind } from "@/lib/orgs/policy";
import type { ConnectionType } from "@/lib/sources/catalog";

import { PostHogFormDialog, type SecretMode } from "./connection-form-dialog";
import { PostgresFormDialog } from "./postgres-form-dialog";
import { SourceFormDialog } from "./source-form-dialog";
import { useWorkspaceId } from "@/lib/apps/use-workspace";

type Connection = {
  id: string;
  name: string;
  type: ConnectionType;
  apps: { id: string; name: string }[];
  kind: ConnectionKind;
  /** The reader holds the sign-in it runs with: a shared one's, or their own. */
  signedIn: boolean;
};

type OpenDialog = "replace" | "rename" | "delete" | "signOut" | null;

/**
 * A connection's menu. Each item is there only if the policy lets the reader
 * do it (`actions`, from lib/orgs/policy): managing it (test, key, rename,
 * delete), signing in to it, signing out of it.
 */
export function ConnectionActions({
  connection,
  actions,
  secretMode,
}: {
  connection: Connection;
  actions: { manage: boolean; signIn: boolean; signOut: boolean };
  secretMode: SecretMode;
}) {
  const orgId = useWorkspaceId();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [testing, startTest] = useTransition();
  const signsIn = connection.kind !== "key";

  function signIn() {
    startTest(async () => {
      const result = await startMcpSignInAction({ orgId, connectionId: connection.id });
      if (result.ok) window.location.assign(result.data.authorizationUrl);
      else toast.error(result.error.message);
    });
  }

  function signOut() {
    startTest(async () => {
      const result = await signOutOfConnectionAction({ id: connection.id });
      if (result.ok) toast.success(`Signed out of ${connection.name}`);
      else toast.error(result.error.message);
    });
  }

  function retest() {
    startTest(async () => {
      const result = await retestConnectionAction({ id: connection.id });
      if (result.ok) toast.success(`${connection.name} is connected`);
      else toast.error(result.error.message);
    });
  }

  const close = (open: boolean) => !open && setDialog(null);
  // Testing a sign-in needs one to test.
  const canTest = actions.manage && (!signsIn || connection.signedIn || connection.kind === "signInShared");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${connection.name}`}>
            {testing ? <Loader2Icon className="animate-spin" aria-hidden /> : <EllipsisIcon aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canTest && (
            <DropdownMenuItem onSelect={retest} disabled={testing}>
              <RefreshCwIcon aria-hidden />
              Test again
            </DropdownMenuItem>
          )}
          {actions.signIn && (
            <DropdownMenuItem onSelect={signIn} disabled={testing}>
              <LogInIcon aria-hidden />
              {connection.signedIn ? "Sign in again" : "Sign in"}
            </DropdownMenuItem>
          )}
          {!signsIn && actions.manage && (
            <DropdownMenuItem onSelect={() => setDialog("replace")}>
              <KeyRoundIcon aria-hidden />
              {["posthog", "bigquery", "ga4", "searchconsole", "mcp"].includes(connection.type) ? "Replace key" : "Change password"}
            </DropdownMenuItem>
          )}
          {actions.signOut && (
            <DropdownMenuItem onSelect={() => setDialog("signOut")} disabled={testing}>
              <LogOutIcon aria-hidden />
              Sign out
            </DropdownMenuItem>
          )}
          {actions.manage && (
            <>
              <DropdownMenuItem onSelect={() => setDialog("rename")}>
                <PencilIcon aria-hidden />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                <Trash2Icon aria-hidden />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {!signsIn &&
        (connection.type === "postgres" ? (
          <PostgresFormDialog mode="replace" connection={connection} open={dialog === "replace"} onOpenChange={close} secretMode={secretMode} />
        ) : connection.type === "posthog" ? (
          <PostHogFormDialog mode="replace" connection={connection} open={dialog === "replace"} onOpenChange={close} secretMode={secretMode} />
        ) : (
          <SourceFormDialog
            type={connection.type}
            mode="replace"
            connection={connection}
            open={dialog === "replace"}
            onOpenChange={close}
            secretMode={secretMode}
          />
        ))}
      <AlertDialog open={dialog === "signOut"} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {connection.kind === "signInShared"
                ? `Everyone in the workspace queries ${connection.name} as you. Once you sign out, nobody is signed in to it, and its dashboards stop loading until someone signs in again.`
                : `Your sign-in is deleted. Dashboards that use ${connection.name} stop loading for you until you sign in again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RenameDialog connection={connection} open={dialog === "rename"} onOpenChange={close} />
      <DeleteDialog connection={connection} open={dialog === "delete"} onOpenChange={close} />
    </>
  );
}

function RenameDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(connection.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameConnectionAction({ id: connection.id, name });
      if (result.ok) {
        toast.success("Connection renamed");
        onOpenChange(false);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setName(connection.name);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Rename connection</DialogTitle>
            <DialogDescription>Only the name changes. Apps keep using this connection.</DialogDescription>
          </DialogHeader>
          <Field className="my-6" data-invalid={!!error || undefined}>
            <FieldLabel htmlFor={id}>Name</FieldLabel>
            <Input
              id={id}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={80}
              autoComplete="off"
              aria-invalid={!!error || undefined}
              autoFocus
            />
            <FieldError>{error}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The apps come from the page's latest data, never a copy: the page stays
  // mounted while hidden, so a copy would outlive apps deleted elsewhere. Only
  // the list the server sends back when it refuses is kept, until next open.
  const [refusedBy, setRefusedBy] = useState<Connection["apps"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Refused over apps the reader can't open: there are none to name, only the server's reason.
  const [refusal, setRefusal] = useState<string | null>(null);
  const blockingApps = refusedBy ?? connection.apps;
  const blocked = blockingApps.length > 0 || refusal !== null;

  // Opened by the row menu through `open`, which doesn't call onOpenChange.
  // Reset while rendering when it opens, so the first frame is already fresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRefusedBy(null);
      setRefusal(null);
      setError(null);
    }
  }

  function confirm() {
    startTransition(async () => {
      const result = await deleteConnectionAction({ id: connection.id });
      if (result.ok) {
        toast.success(`${connection.name} deleted`);
        onOpenChange(false);
      } else if (result.error.code === "in_use") {
        if (result.error.apps?.length) setRefusedBy(result.error.apps);
        setRefusal(result.error.message);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `${connection.name} is in use` : `Delete ${connection.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {blocked && !blockingApps.length ? (
                <p>{refusal}</p>
              ) : blocked ? (
                <>
                  {/* The server's count includes apps the reader can't open. */}
                  <p>
                    {refusal ??
                      `${blockingApps.length === 1 ? "1 app uses" : `${blockingApps.length} apps use`} this connection. Delete ${blockingApps.length === 1 ? "it" : "them"} first.`}
                  </p>
                  <ul className="mt-3 list-disc pl-5 text-foreground">
                    {blockingApps.map((app) => (
                      <li key={app.id}>{app.name}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>This deletes the connection and its stored credential. It can&apos;t be undone.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
            <Button variant="destructive" onClick={confirm} disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              Delete
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
