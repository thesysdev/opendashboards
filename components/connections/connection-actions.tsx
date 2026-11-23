"use client";

import { EllipsisIcon, KeyRoundIcon, Loader2Icon, LockIcon, PencilIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteConnectionAction,
  renameConnectionAction,
  retestConnectionAction,
  setConnectionSharingAction,
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
  /** "oauth": signed in with OAuth, so it can be signed in to again instead of given a key. */
  signIn?: "oauth" | null;
  /** Whether a sign-in serves only its owner or the whole workspace. */
  sharing?: "personal" | "org";
  /** Whether the person looking at it is who added it (for a sign-in: who signed in). */
  mine?: boolean;
};

type OpenDialog = "replace" | "rename" | "delete" | "share" | null;

/**
 * For someone who can't manage connections (a viewer) whose own sign-in is
 * shared with the workspace: the one thing they can still do is take it back,
 * so nobody keeps querying as them.
 */
export function StopSharingButton({ connection }: { connection: { id: string; name: string } }) {
  const [pending, startTransition] = useTransition();
  function stop() {
    startTransition(async () => {
      const result = await setConnectionSharingAction({ id: connection.id, sharing: "personal" });
      if (!result.ok) toast.error(result.error.message);
      else toast.success(`${connection.name} is yours alone again`);
    });
  }
  return (
    <Button variant="outline" size="sm" onClick={stop} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <LockIcon aria-hidden />}
      Stop sharing
    </Button>
  );
}

export function ConnectionActions({
  connection,
  secretMode,
  team,
}: {
  connection: Connection;
  secretMode: SecretMode;
  /** The workspace this connection is in, by name, when it has other people. Null when there's nobody to share with. */
  team?: string | null;
}) {
  const orgId = useWorkspaceId();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // A sign-in runs as one person, so only that person signs in again or decides who else it serves.
  const ownSignIn = connection.signIn === "oauth" && connection.mine !== false;
  const canShare = ownSignIn && Boolean(team);

  function setSharing(sharing: "personal" | "org") {
    startTest(async () => {
      const result = await setConnectionSharingAction({ id: connection.id, sharing });
      if (!result.ok) toast.error(result.error.message);
      else toast.success(sharing === "org" ? `${connection.name} is shared with ${team}` : `${connection.name} is yours alone again`);
    });
  }
  const [testing, startTest] = useTransition();

  function signInAgain() {
    startTest(async () => {
      const result = await startMcpSignInAction({ orgId, connectionId: connection.id });
      if (result.ok) window.location.assign(result.data.authorizationUrl);
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${connection.name}`}>
            {testing ? <Loader2Icon className="animate-spin" aria-hidden /> : <EllipsisIcon aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={retest} disabled={testing}>
            <RefreshCwIcon aria-hidden />
            Test again
          </DropdownMenuItem>
          {connection.signIn === "oauth" ? (
            ownSignIn && (
              <DropdownMenuItem onSelect={signInAgain} disabled={testing}>
                <KeyRoundIcon aria-hidden />
                Sign in again
              </DropdownMenuItem>
            )
          ) : (
            <DropdownMenuItem onSelect={() => setDialog("replace")}>
              <KeyRoundIcon aria-hidden />
              {["posthog", "bigquery", "ga4", "searchconsole", "mcp"].includes(connection.type) ? "Replace key" : "Change password"}
            </DropdownMenuItem>
          )}
          {canShare &&
            (connection.sharing === "org" ? (
              <DropdownMenuItem onSelect={() => setSharing("personal")} disabled={testing}>
                <LockIcon aria-hidden />
                Stop sharing
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setDialog("share")}>
                <UsersIcon aria-hidden />
                Share with workspace
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem onSelect={() => setDialog("rename")}>
            <PencilIcon aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {connection.type === "postgres" ? (
        <PostgresFormDialog
          mode="replace"
          connection={connection}
          open={dialog === "replace"}
          onOpenChange={close}
          secretMode={secretMode}
        />
      ) : connection.type === "posthog" ? (
        <PostHogFormDialog
          mode="replace"
          connection={connection}
          open={dialog === "replace"}
          onOpenChange={close}
          secretMode={secretMode}
        />
      ) : (
        <SourceFormDialog
          type={connection.type}
          mode="replace"
          connection={connection}
          open={dialog === "replace"}
          onOpenChange={close}
          secretMode={secretMode}
        />
      )}
      <AlertDialog open={dialog === "share"} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Share your {connection.name} sign-in with {team}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in {team} will query {connection.name} as you, with whatever your account allows. They never see your
              sign-in. Tools the server marks as changing data are skipped, but not every server marks them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setSharing("org")}>Share</AlertDialogAction>
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
        else setRefusal(result.error.message);
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
                  <p>Dashboards in these apps use this connection. Delete those apps first.</p>
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
