"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The sidebar: the brand, the apps, the nav and the user.
 *
 * On a wide screen it sits beside the content, and the reader can collapse it
 * and open it again; their choice is remembered in this browser. Until they
 * choose it's open, except for a guest looking at an app that was shared with
 * them, who came for the dashboard: there it starts collapsed. That default
 * is decided in CSS (app/globals.css) from what the server rendered, so the
 * sidebar never flashes open first.
 *
 * Collapsed, it leaves nothing beside the content. `OpenSidebarButton`, in
 * the page, opens it again. On a phone there's no room beside the content, so
 * the sidebar is always collapsed and the button floats it over the page
 * until the reader picks something or taps away.
 */

/** Where this browser remembers whether the reader wants the sidebar open. */
const PREFERENCE_KEY = "opendashboards:sidebar";

type Preference = "open" | "collapsed";

/** From here up the sidebar fits beside the content: Tailwind's `md`. */
const WIDE = "(min-width: 48rem)";

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** What the reader chose in this browser, or "none": the stylesheet then picks the default. */
function readPreference(): Preference | "none" {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY);
    return stored === "open" || stored === "collapsed" ? stored : "none";
  } catch {
    return "none";
  }
}

function choose(next: Preference) {
  try {
    localStorage.setItem(PREFERENCE_KEY, next);
  } catch {}
  notify();
}

// Whether the sidebar is floating over the content right now: only ever on a phone. Never remembered.
let floating = false;

function setFloating(next: boolean) {
  if (floating === next) return;
  floating = next;
  notify();
}

/** On the server nobody has chosen yet, so the page arrives with the default for whoever is reading. */
const usePreference = () => useSyncExternalStore(subscribe, readPreference, () => "none" as const);
const useFloating = () =>
  useSyncExternalStore(
    subscribe,
    () => floating,
    () => false,
  );

const isWide = () => window.matchMedia(WIDE).matches;

export function Sidebar({ children }: { children: React.ReactNode }) {
  const preference = usePreference();
  const isFloating = useFloating();

  // Escape puts a floating sidebar away, as going somewhere does (CloseOnNavigate).
  useEffect(() => {
    if (!isFloating) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFloating(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFloating]);

  return (
    <>
      {/* Reads the URL, which is only known at request time: behind Suspense so the shell still prerenders. */}
      <Suspense fallback={null}>
        <CloseOnNavigate />
      </Suspense>
      {/* Tapping anywhere else puts it away. */}
      {isFloating && <div aria-hidden className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setFloating(false)} />}
      <aside
        data-sidebar
        data-pref={preference}
        data-floating={isFloating}
        className="relative hidden w-60 shrink-0 flex-col px-2 py-3 md:flex"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isFloating ? "Close the sidebar" : "Collapse the sidebar"}
          title={isFloating ? "Close the sidebar" : "Collapse the sidebar"}
          onClick={() => (isFloating ? setFloating(false) : choose("collapsed"))}
          className="absolute top-3.5 right-2 text-muted-foreground"
        >
          <PanelLeftCloseIcon aria-hidden />
        </Button>
        {children}
      </aside>
    </>
  );
}

/** Going somewhere puts a floating sidebar away. */
function CloseOnNavigate() {
  const pathname = usePathname();
  useEffect(() => setFloating(false), [pathname]);
  return null;
}

/**
 * Brings a collapsed sidebar back; shown only while it's collapsed (always,
 * on a phone). Clicking opens it for good on a wide screen, and floats it
 * over the page on a phone. An app's header has
 * one at its start. On pages without such a header the shell's own
 * (`floating`) sits at the top left of the content; it hides wherever a page
 * brings its own.
 */
export function OpenSidebarButton({ floating: shellsOwn = false, className }: { floating?: boolean; className?: string }) {
  const preference = usePreference();
  const isFloating = useFloating();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-sidebar-open
      data-pref={preference}
      data-floating={shellsOwn || undefined}
      aria-label="Open the sidebar"
      aria-expanded={isFloating}
      title="Open the sidebar"
      onClick={() => {
        if (!isWide()) return setFloating(!isFloating);
        setFloating(false);
        choose("open");
      }}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <PanelLeftOpenIcon aria-hidden />
    </Button>
  );
}

/**
 * Rendered by an app's page when the reader is a guest there: its presence is
 * what collapses the sidebar by default (see `Sidebar`).
 */
export function GuestAppMarker() {
  return <span data-guest-app hidden />;
}
