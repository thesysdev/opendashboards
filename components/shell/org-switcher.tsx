"use client";

import { CheckIcon, ChevronsUpDownIcon, LogOutIcon, PlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useRef, useState, useTransition } from "react";

import { checkoutWorkspaceAction, createOrgAction, paidPlansAction, switchDevUserAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { workspacePath } from "@/lib/apps/paths";
import { cn } from "@/lib/utils";

import { AvatarCircle } from "./avatar-circle";

export type SwitcherOrg = { id: string; name: string };

/** The gateway in front of OpenDashboards owns the session: it signs out on a POST here and sends the browser to `next`. */
const SIGN_OUT_URL = "/auth/signout?next=/";

/**
 * Who is signed in and which workspace is on screen, with the menu to go to
 * another (its own address), create one, or manage this one. `compact` is
 * the avatar alone, for the mobile top bar.
 */
export function OrgSwitcher({
  email,
  orgs,
  activeId,
  compact = false,
  devUsers,
}: {
  email: string;
  orgs: SwitcherOrg[];
  activeId: string;
  compact?: boolean;
  /** Local development only: stand-in people to act as. */
  devUsers?: readonly string[];
}) {
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const active = orgs.find((org) => org.id === activeId);

  function actAs(name: string | null) {
    startTransition(async () => {
      await switchDevUserAction(name);
      // A full load, on purpose: everything on screen, the sidebar included, was rendered for the previous person.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/apps");
    });
  }

  const signOut = useRef<HTMLFormElement>(null);
  function logOut() {
    // Whoever signs in next on this browser isn't counted as this person.
    if (posthog.__loaded) posthog.reset();
    signOut.current?.submit();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <button
              type="button"
              aria-label={`Signed in as ${email}. Switch workspace`}
              className="rounded-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <AvatarCircle name={email} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Signed in as ${email}, in ${active?.name ?? "a workspace"}. Switch workspace`}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04]",
                "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                pending && "opacity-60",
              )}
            >
              <AvatarCircle name={email} className="size-7" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground/90">{active?.name}</span>
                <span className="block truncate text-xs text-muted-foreground" title={email}>
                  {email}
                </span>
              </span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-60">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{email}</DropdownMenuLabel>
          {orgs.map((org) => (
            <DropdownMenuItem key={org.id} asChild disabled={pending}>
              <Link href={workspacePath(org.id)}>
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {org.id === activeId && <CheckIcon aria-label="Open now" />}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={workspacePath(activeId, "settings")}>
              <UsersIcon aria-hidden />
              Workspace settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            Create a workspace
          </DropdownMenuItem>
          {devUsers && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Local only: act as</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => actAs(null)} disabled={pending}>
                The dev user
              </DropdownMenuItem>
              {devUsers.map((name) => (
                <DropdownMenuItem key={name} onSelect={() => actAs(name)} disabled={pending}>
                  {name}@example.dev
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logOut}>
            <LogOutIcon aria-hidden />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={signOut} method="post" action={SIGN_OUT_URL} hidden />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** Names a new workspace. Its creator is its first admin, and it opens straight away. */
export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Set once the server says this workspace must be paid for: the plan and period to buy. */
  const [paid, setPaid] = useState<{ planId: string; interval: "month" | "year" } | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      if (paid) {
        const checkout = await checkoutWorkspaceAction({ name, ...paid });
        if (checkout.ok) window.location.assign(checkout.data.url);
        else setError(checkout.error.message);
        return;
      }
      const result = await createOrgAction({ name });
      if (!result.ok) {
        setError(result.error.message);
        // Their one Free workspace is taken: this one is paid for first.
        if (result.error.code === "plan_limit") {
          const plans = await paidPlansAction();
          setPlans(plans);
          if (plans[0]) setPaid({ planId: plans[0].id, interval: "year" });
        }
        return;
      }
      onOpenChange(false);
      setName("");
      router.push(workspacePath(result.data.id, "settings"));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>
              A workspace has its own apps, data connections and members. Your other workspaces stay as they are.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={60}
              placeholder="Acme"
              autoFocus
              aria-invalid={error ? true : undefined}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          {paid && (
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Plan"
                value={paid.planId}
                onChange={(event) => setPaid({ ...paid, planId: event.target.value })}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Billing period"
                value={paid.interval}
                onChange={(event) => setPaid({ ...paid, interval: event.target.value as "month" | "year" })}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="year">Billed annually</option>
                <option value="month">Billed monthly</option>
              </select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : paid ? "Continue to payment" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
