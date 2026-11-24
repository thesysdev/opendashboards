"use client";

import { BuildingIcon, CheckIcon, LinkIcon, Loader2Icon, LockIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import {
  addAppGuestAction,
  removeAppGuestAction,
  setAppTeamAccessAction,
  shareAppWithMemberAction,
  unshareAppWithMemberAction,
} from "@/app/(app)/apps/actions";
import { AvatarCircle } from "@/components/shell/avatar-circle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AppResult } from "@/lib/apps/errors";
import { appPath } from "@/lib/apps/paths";
import { useWorkspaceId } from "@/lib/apps/use-workspace";
import type { AppTeamAccess } from "@/lib/db/schema";

type App = { id: string; name: string; teamAccess: AppTeamAccess };
/** A member of the workspace other than the app's owner, and what the app gave them by name, if anything. */
type Teammate = { id: string; email: string; viewer: boolean; access: "view" | "edit" | null };
type Level = "view" | "edit";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who can open the app, laid out like a shared document: a box to add people,
 * the people who have access, the people outside the workspace who do, and
 * what everyone in the workspace gets. Every change applies at once. The
 * app's dashboards follow it; chats stay each person's own.
 */
export function ShareApp({
  app,
  workspace,
  owner,
  personalConnections,
  guests,
  teammates,
  dashboardCount,
}: {
  app: App;
  /** The workspace's name. */
  workspace: string;
  /** The app's owner, and whether that's the person looking. */
  owner: { email: string; you: boolean };
  /** How many of the app's connections are personal sign-ins: others can't query through them. */
  personalConnections: number;
  /** People outside the workspace who may view the app, by email. */
  guests: string[];
  /** The workspace's other members: the ones the app is shared with by name, and the ones it could be. */
  teammates: Teammate[];
  /** How many dashboards the app has: its first one is the moment to suggest sharing. */
  dashboardCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nudge = useShareNudge(app.id, dashboardCount);
  const added = teammates.filter((teammate) => teammate.access);
  const unshared = app.teamAccess === "private" && !guests.length && !added.length;
  // Nothing to suggest once it's shared.
  const showNudge = nudge.pending && !open && unshared;

  function openDialog(next: boolean) {
    if (next) {
      setError(null);
      // Opening Share answers the suggestion.
      nudge.dismiss();
    }
    setOpen(next);
  }

  /** Runs one change. What it shows comes back from the server: the page re-renders with it. */
  function change(action: () => Promise<AppResult>, done?: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      if (done) toast.success(done);
    });
  }

  const shareWith = (teammate: Teammate, access: Level) =>
    change(
      () => shareAppWithMemberAction({ id: app.id, memberId: teammate.id, access }),
      `${teammate.email} can ${access === "edit" ? "edit" : "view"} this app`,
    );

  return (
    <>
      <div className="relative">
        <Button variant="outline" size="sm" onClick={() => openDialog(true)}>
          {unshared ? <LockIcon aria-hidden /> : <UsersIcon aria-hidden />}
          Share
        </Button>
        {showNudge && (
          <div
            role="status"
            className="absolute top-full right-0 z-30 mt-2 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            {/* Points at the Share button above. */}
            <span aria-hidden className="absolute -top-1.5 right-6 size-3 rotate-45 border-t border-l bg-popover" />
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm">Your dashboard is ready. Share it with your workspace or a client.</p>
              <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={nudge.dismiss} className="-mt-1 -mr-1">
                <XIcon aria-hidden />
              </Button>
            </div>
            <Button size="sm" className="mt-2" onClick={() => openDialog(true)}>
              Share
            </Button>
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={openDialog}>
        {/* One column no wider than the dialog: on a phone a long email is cut short, and what's beside it stays on screen. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share “{app.name}”</DialogTitle>
            <DialogDescription className="sr-only">Its dashboards are shared with it. Chats stay your own.</DialogDescription>
          </DialogHeader>

          <AddPeople
            teammates={teammates}
            guests={guests}
            pending={pending}
            onTeammate={(teammate) => shareWith(teammate, "view")}
            onExternal={(email) =>
              change(() => addAppGuestAction({ id: app.id, email }), `${email} can view this app once they sign in with that email`)
            }
          />

          <section aria-labelledby="share-people" className="mt-4">
            <SectionTitle id="share-people">People with access</SectionTitle>
            <ul>
              <Person email={owner.email} note={owner.you ? "You" : undefined}>
                <span className="pr-2 text-sm text-muted-foreground">Owner</span>
              </Person>
              {added.map((teammate) => (
                <Person key={teammate.id} email={teammate.email} note={teammate.viewer ? "Viewer in this workspace" : undefined}>
                  <RoleSelect
                    label={`Access for ${teammate.email}`}
                    value={teammate.viewer ? "view" : teammate.access!}
                    editor={!teammate.viewer}
                    disabled={pending}
                    onChange={(level) => shareWith(teammate, level)}
                    onRemove={() => change(() => unshareAppWithMemberAction({ id: app.id, memberId: teammate.id }))}
                  />
                </Person>
              ))}
            </ul>
          </section>

          {guests.length > 0 && (
            <section aria-labelledby="share-external" className="mt-4">
              <SectionTitle id="share-external">External</SectionTitle>
              <p className="mb-1 text-xs text-muted-foreground">Not in {workspace}. They can view this app and nothing else.</p>
              <ul>
                {guests.map((guest) => (
                  <Person key={guest} email={guest}>
                    {/* Viewing is all someone outside the workspace can have: nothing to choose, only to remove. */}
                    <span className="text-sm text-muted-foreground">Viewer</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${guest}`}
                      disabled={pending}
                      onClick={() => change(() => removeAppGuestAction({ id: app.id, email: guest }))}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </Person>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="share-general" className="mt-4">
            <SectionTitle id="share-general">General access</SectionTitle>
            <div className="flex items-center gap-3 py-1.5">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                {app.teamAccess === "private" ? <LockIcon className="size-4" /> : <BuildingIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">Everyone in {workspace}</p>
                <p className="text-xs text-muted-foreground">
                  {app.teamAccess === "private"
                    ? "Only the people above can open it."
                    : app.teamAccess === "view"
                      ? "Anyone in the workspace can view it."
                      : "Anyone in the workspace can open it; editors and admins can build in it."}
                </p>
              </div>
              <select
                aria-label={`Access for everyone in ${workspace}`}
                value={app.teamAccess}
                disabled={pending}
                onChange={(event) => {
                  const teamAccess = event.target.value as AppTeamAccess;
                  change(
                    () => setAppTeamAccessAction({ id: app.id, teamAccess }),
                    teamAccess === "private" ? `${app.name} is no longer shared with ${workspace}` : `${app.name} is shared with ${workspace}`,
                  );
                }}
                className={selectClass}
              >
                <option value="private">No access</option>
                <option value="view">Viewer</option>
                <option value="edit">Editor</option>
              </select>
            </div>
          </section>

          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            <p>Only share with people you trust.</p>
            {personalConnections > 0 && (
              <p>
                This app uses {personalConnections === 1 ? "1 connection that requires" : `${personalConnections} connections that require`}{" "}
                sign-in. Members sign in with their own account to see its data, and guests can&apos;t be added.
              </p>
            )}
          </div>
          <DialogFooter>
            <CopyLink appId={app.id} />
            <Button onClick={() => setOpen(false)}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const selectClass =
  "h-8 shrink-0 rounded-md border-0 bg-transparent px-1.5 text-sm [text-align-last:right] text-foreground hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-1 text-sm font-medium">
      {children}
    </h3>
  );
}

/** One row of someone with access: who they are, and on the right what they have. */
function Person({ email, note, children }: { email: string; note?: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <AvatarCircle name={email} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{email}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </li>
  );
}

/** What one person has, changed in place: Viewer, Editor where their role allows it, or nothing at all. */
function RoleSelect({
  label,
  value,
  editor,
  disabled,
  onChange,
  onRemove,
}: {
  label: string;
  value: Level;
  /** Whether Editor can be chosen. Not for a viewer in the workspace, or someone outside it. */
  editor: boolean;
  disabled?: boolean;
  onChange: (value: Level) => void;
  onRemove: () => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "remove") onRemove();
        else if (next !== value) onChange(next === "edit" ? "edit" : "view");
      }}
      className={selectClass}
    >
      <option value="view">Viewer</option>
      {editor && <option value="edit">Editor</option>}
      <option value="remove">Remove access</option>
    </select>
  );
}

/**
 * The box people are added from. Typing suggests teammates the app isn't
 * shared with yet; an email that isn't a teammate's adds someone outside the
 * workspace, to view. A teammate starts as a viewer, changed in their row.
 */
function AddPeople({
  teammates,
  guests,
  pending,
  onTeammate,
  onExternal,
}: {
  teammates: Teammate[];
  guests: string[];
  pending: boolean;
  onTeammate: (teammate: Teammate) => void;
  onExternal: (email: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const typed = query.trim().toLowerCase();
  const suggestions = teammates.filter((teammate) => !teammate.access && teammate.email.toLowerCase().includes(typed)).slice(0, 6);
  const known = teammates.some((teammate) => teammate.email.toLowerCase() === typed) || guests.includes(typed);
  const external = EMAIL.test(typed) && !known ? typed : null;
  const openList = focused && (suggestions.length > 0 || external !== null);

  function pick(choice: Teammate | string) {
    if (typeof choice === "string") onExternal(choice);
    else onTeammate(choice);
    setQuery("");
  }

  return (
    <div
      className="relative mt-3"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Input
        type="text"
        role="combobox"
        aria-expanded={openList}
        aria-controls="share-suggestions"
        aria-label="Add people"
        autoComplete="off"
        placeholder={teammates.length ? "Add members or an email" : "Add someone by email"}
        value={query}
        disabled={pending}
        onFocus={() => setFocused(true)}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = external ?? (typed ? suggestions[0] : undefined);
          if (first) pick(first);
        }}
        className="h-10"
      />
      {openList && (
        <ul id="share-suggestions" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border bg-popover p-1 shadow-lg">
          {suggestions.map((teammate) => (
            <li key={teammate.id} role="option" aria-selected={false}>
              <button
                type="button"
                // Keeps the box focused, so the list stays for the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(teammate)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
              >
                <AvatarCircle name={teammate.email} className="size-7" />
                <span className="min-w-0 flex-1 truncate text-sm">{teammate.email}</span>
                {teammate.viewer && <span className="text-xs text-muted-foreground">Viewer in this workspace</span>}
              </button>
            </li>
          ))}
          {external && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(external)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
              >
                <AvatarCircle name={external} className="size-7" />
                <span className="min-w-0 flex-1 truncate text-sm">{external}</span>
                <span className="text-xs text-muted-foreground">External, can view</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/*
 * The suggestion to share, made when an app gets its first dashboard. It's
 * kept in this browser: "pending" from that moment until it's dismissed or
 * Share is opened, so it survives a reload and never comes back for that app.
 */
const nudgeKey = (appId: string) => `opendashboards:share-nudge:${appId}`;
const nudgeListeners = new Set<() => void>();

function readNudge(appId: string) {
  try {
    return window.localStorage.getItem(nudgeKey(appId));
  } catch {
    return null;
  }
}

function writeNudge(appId: string, value: "pending" | "done") {
  try {
    window.localStorage.setItem(nudgeKey(appId), value);
  } catch {
    // Without storage the suggestion just doesn't show.
  }
  nudgeListeners.forEach((listener) => listener());
}

function subscribeNudge(listener: () => void) {
  nudgeListeners.add(listener);
  return () => void nudgeListeners.delete(listener);
}

function useShareNudge(appId: string, dashboardCount: number) {
  const state = useSyncExternalStore(
    subscribeNudge,
    () => readNudge(appId),
    () => null,
  );
  // The first dashboard arriving while the app is open is the moment.
  const before = useRef(dashboardCount);
  useEffect(() => {
    if (before.current === 0 && dashboardCount > 0 && readNudge(appId) === null) writeNudge(appId, "pending");
    before.current = dashboardCount;
  }, [appId, dashboardCount]);

  return { pending: state === "pending", dismiss: () => state === "pending" && writeNudge(appId, "done") };
}

/**
 * Copies the app's link, to send to whoever it's shared with. The link opens
 * for nobody else: they still have to sign in as someone who's been let in.
 */
function CopyLink({ appId }: { appId: string }) {
  const orgId = useWorkspaceId();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(appPath(orgId, appId), window.location.origin).href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link. Copy it from the address bar instead.");
    }
  }

  return (
    <Button type="button" variant="ghost" onClick={copy} className="sm:mr-auto">
      {copied ? <CheckIcon aria-hidden /> : <LinkIcon aria-hidden />}
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}
