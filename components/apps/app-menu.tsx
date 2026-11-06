"use client";

import { EllipsisIcon, Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteAppAction, renameAppAction } from "@/app/(app)/apps/actions";
import {
  AlertDialog,
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

type App = { id: string; name: string; dashboardCount: number };

export function AppMenu({ app }: { app: App }) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${app.name}`}>
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>
            <PencilIcon aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            <Trash2Icon aria-hidden />
            Delete app
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog app={app} open={dialog === "rename"} onOpenChange={close} />
      <DeleteDialog app={app} open={dialog === "delete"} onOpenChange={close} />
    </>
  );
}

function RenameDialog({
  app,
  open,
  onOpenChange,
}: {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(app.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameAppAction({ id: app.id, name });
      if (result.ok) {
        toast.success("App renamed");
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
          setName(app.name);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Rename app</DialogTitle>
            <DialogDescription>The dashboards and build history stay as they are.</DialogDescription>
          </DialogHeader>
          <Field className="my-6" data-invalid={!!error || undefined}>
            <FieldLabel htmlFor={id}>Name</FieldLabel>
            <Input
              id={id}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
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
  app,
  open,
  onOpenChange,
}: {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      // Only returns when deleting failed; on success it navigates to /apps.
      const result = await deleteAppAction({ id: app.id });
      if (result && !result.ok) setError(result.error.message);
      else toast.success(`${app.name} deleted`);
    });
  }

  const dashboards =
    app.dashboardCount === 1 ? "its dashboard" : app.dashboardCount ? `its ${app.dashboardCount} dashboards` : null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the app{dashboards ? `, ${dashboards}` : ""} and its build history. It can&apos;t be
            undone. Your data connections aren&apos;t affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            Delete app
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
