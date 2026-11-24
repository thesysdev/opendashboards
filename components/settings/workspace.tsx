"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  changeMemberRoleAction,
  deleteOrgAction,
  inviteMemberAction,
  leaveOrgAction,
  removeMemberAction,
  renameOrgAction,
  revokeInviteAction,
} from "@/app/(app)/settings/actions";
import { removeAppGuestAction } from "@/app/(app)/apps/actions";
import { AvatarCircle } from "@/components/shell/avatar-circle";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OrgRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const ROLES: { value: OrgRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

const roleLabel = (role: OrgRole) => ROLES.find((entry) => entry.value === role)!.label;
const article = (role: OrgRole) => (role === "admin" || role === "editor" ? "an" : "a");

function RoleSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: OrgRole;
  onChange: (role: OrgRole) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as OrgRole)}
      className={cn(
        "h-8 rounded-md border bg-background px-2 text-sm",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
      )}
    >
      {ROLES.map((role) => (
        <option key={role.value} value={role.value}>
          {role.label}
        </option>
      ))}
    </select>
  );
}

/** The workspace's name, for an admin to change. Everyone sees it in their switcher. */
export function WorkspaceNameForm({ orgId, name }: { orgId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = value.trim() !== name && value.trim() !== "";
  const id = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameOrgAction({ orgId, name: value });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success("Workspace renamed");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border">
      <div className="p-4">
        <label htmlFor={id} className="text-sm font-medium">
          Workspace name
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">What everyone here sees in their workspace switcher.</p>
        <Input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          maxLength={60}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-3 h-9 max-w-md"
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-b-xl border-t bg-neutral-50/70 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">Up to 60 characters.</p>
        <Button type="submit" size="sm" disabled={pending || !changed}>
          {pending && <Loader2Icon className="animate-spin" aria-hidden />}
          Save
        </Button>
      </div>
    </form>
  );
}

/** Adds someone by email. Nothing is sent and nothing is accepted: they're a member on their next sign-in. */
export function InviteForm({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await inviteMemberAction({ orgId, email, role });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(
        result.data.status === "added"
          ? `${email.trim()} is now in the workspace`
          : `${email.trim()} will join the first time they sign in`,
      );
      setEmail("");
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          aria-label="Email"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="h-8 min-w-48 flex-1 bg-background"
        />
        <RoleSelect value={role} onChange={setRole} label="Role" />
        <Button type="submit" size="sm" disabled={pending || !email.trim()}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function MemberRow({
  orgId,
  member,
  canManage,
  lastAdmin,
}: {
  orgId: string;
  member: { userId: string; email: string | null; role: OrgRole; you: boolean; appCount: number; guestAppCount: number };
  canManage: boolean;
  lastAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  // Your own role, lowered: you lose the controls to put it back, so it's asked first.
  const [demoting, setDemoting] = useState<OrgRole | null>(null);
  const name = member.email ?? "Someone who hasn't signed in lately";

  function changeRole(role: OrgRole) {
    startTransition(async () => {
      const result = await changeMemberRoleAction({ orgId, userId: member.userId, role });
      if (!result.ok) toast.error(result.error.message);
    });
  }

  function pickRole(role: OrgRole) {
    if (member.you && member.role === "admin" && role !== "admin") setDemoting(role);
    else changeRole(role);
  }

  function remove() {
    startTransition(async () => {
      const result = await removeMemberAction({ orgId, userId: member.userId });
      if (!result.ok) toast.error(result.error.message);
      else toast.success(`${name} was removed`);
    });
  }

  return (
    <li className="flex items-center gap-3 p-3.5">
      <AvatarCircle name={member.email ?? "?"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {member.you && <span className="ml-1.5 font-normal text-muted-foreground">(you)</span>}
        </p>
      </div>
      {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      {canManage ? (
        <RoleSelect value={member.role} onChange={pickRole} disabled={pending || lastAdmin} label={`Role of ${name}`} />
      ) : (
        <span className="text-sm text-muted-foreground">{roleLabel(member.role)}</span>
      )}
      <AlertDialog open={demoting !== null} onOpenChange={(open) => !open && setDemoting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make yourself {demoting ? `${article(demoting)} ${roleLabel(demoting)}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose the admin controls straight away, and only another admin can give them back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => demoting && changeRole(demoting)}>Change my role</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {canManage && !member.you && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
            Remove
          </Button>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    {member.appCount > 0 && (
                      <p className="font-medium text-destructive">
                        This also deletes {member.appCount === 1 ? "the 1 app" : `the ${member.appCount} apps`} they made, with
                        every dashboard in {member.appCount === 1 ? "it" : "them"}, for everyone they&apos;re shared with. It
                        can&apos;t be undone.
                      </p>
                    )}
                    <p>
                      They lose access to this workspace straight away
                      {member.guestAppCount > 0 &&
                        `, including ${member.guestAppCount === 1 ? "the 1 app" : `the ${member.guestAppCount} apps`} they were a guest of`}
                      . Their sign-ins are deleted; the connections they added stay.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>
                  {member.appCount > 0 ? "Remove and delete their apps" : "Remove"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </li>
  );
}

export function PendingInviteRow({
  orgId,
  invite,
  canManage,
}: {
  orgId: string;
  invite: { email: string; role: OrgRole };
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  function revoke() {
    startTransition(async () => {
      const result = await revokeInviteAction({ orgId, email: invite.email });
      if (!result.ok) toast.error(result.error.message);
      else toast.success(`Invite to ${invite.email} revoked`);
    });
  }
  return (
    <li className="flex items-center gap-3 p-3.5">
      <AvatarCircle name={invite.email} className="bg-neutral-100 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.email}</p>
        <p className="text-sm text-muted-foreground">Hasn&apos;t signed in yet</p>
      </div>
      <span className="text-sm text-muted-foreground">{roleLabel(invite.role)}</span>
      {canManage && (
        <Button variant="ghost" size="sm" onClick={revoke} disabled={pending}>
          Revoke
        </Button>
      )}
    </li>
  );
}

/** One guest of one app, for the workspace's admins: who, on which app, let in by whom. */
export function GuestRow({
  guest,
}: {
  /** `alsoMember`: they joined the workspace since; removing them from it ends this too. */
  guest: { appId: string; appName: string; email: string; invitedBy: string | null; alsoMember: boolean };
}) {
  const [pending, startTransition] = useTransition();
  function remove() {
    startTransition(async () => {
      const result = await removeAppGuestAction({ id: guest.appId, email: guest.email });
      if (!result.ok) toast.error(result.error.message);
      else toast.success(`${guest.email} can no longer view ${guest.appName}`);
    });
  }
  return (
    <li className="flex items-center gap-3 p-3.5">
      <AvatarCircle name={guest.email} className="bg-neutral-100 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{guest.email}</span>
          {guest.alsoMember && (
            <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] font-normal text-neutral-600">Also a member</span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          Can view {guest.appName}
          {guest.invitedBy ? ` · added by ${guest.invitedBy}` : ""}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
        Remove
      </Button>
    </li>
  );
}

/**
 * The actions that can't be taken back, set apart at the end of the page:
 * leaving the workspace, and for an admin, deleting it.
 */
export function DangerZone({
  orgId,
  name,
  canDelete,
  appCount,
}: {
  orgId: string;
  name: string;
  canDelete: boolean;
  /** How many apps the reader made here: leaving deletes them. */
  appCount: number;
}) {
  return (
    <ul className="divide-y divide-destructive/20 rounded-xl border border-destructive/30">
      <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Leave this workspace</p>
          <p className="text-sm text-muted-foreground">
            You lose access to its apps and data connections, and the apps you made here are deleted.
          </p>
        </div>
        <LeaveWorkspaceButton orgId={orgId} name={name} appCount={appCount} />
      </li>
      {canDelete && (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Delete this workspace</p>
            <p className="text-sm text-muted-foreground">
              Deletes it for everyone: every member&apos;s apps and dashboards, its data connections and its member list. It
              can&apos;t be undone.
            </p>
          </div>
          <DeleteWorkspaceButton orgId={orgId} name={name} />
        </li>
      )}
    </ul>
  );
}

/**
 * Deletes the workspace and everything in it, for everyone. Admins only, and
 * only once its name is typed out: there is no undo.
 */
export function DeleteWorkspaceButton({ orgId, name }: { orgId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === name;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!matches) return;
    startTransition(async () => {
      // On success the action leaves for another workspace, or the screen to create one.
      const result = await deleteOrgAction({ orgId, name: typed });
      if (result && !result.ok) setError(result.error.message);
    });
  }

  // Every way of closing it (Cancel, Escape, a click outside) forgets what was typed.
  function change(next: boolean) {
    if (pending) return;
    if (!next) {
      setTyped("");
      setError(null);
    }
    setOpen(next);
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)} className="shrink-0">
        Delete workspace
      </Button>
      <Dialog
        open={open}
        onOpenChange={change}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Delete {name}?</DialogTitle>
              <DialogDescription>
                This deletes the workspace for everyone in it: every member&apos;s apps and dashboards, all its data connections
                and their stored credentials, and its member list. It can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <Field className="my-6" data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="delete-workspace-name">
                Type <span className="font-semibold">{name}</span> to confirm
              </FieldLabel>
              <Input
                id="delete-workspace-name"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setError(null);
                }}
                autoComplete="off"
                autoFocus
                aria-invalid={!!error || undefined}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => change(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || pending}>
                {pending && <Loader2Icon className="animate-spin" aria-hidden />}
                Delete workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeaveWorkspaceButton({ orgId, name, appCount }: { orgId: string; name: string; appCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  function leave() {
    startTransition(async () => {
      const result = await leaveOrgAction({ orgId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      router.push("/apps");
    });
  }
  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)} disabled={pending} className="shrink-0">
        Leave workspace
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {appCount > 0 && (
                  <p className="font-medium text-destructive">
                    This also deletes {appCount === 1 ? "the 1 app" : `the ${appCount} apps`} you made here, with every
                    dashboard in {appCount === 1 ? "it" : "them"}, for everyone {appCount === 1 ? "it's" : "they're"} shared
                    with. It can&apos;t be undone.
                  </p>
                )}
                <p>You lose access to its apps and data connections straight away. Connections you added with a key or password keep working.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={leave}>
              {appCount > 0 ? "Leave and delete my apps" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
