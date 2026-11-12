import { useSyncExternalStore } from "react";

/**
 * The prompt a signed-out visitor wrote on the landing page, kept in the
 * browser while they sign in. localStorage, so it's still there when a
 * sign-in link opens in another tab. Creating an app forgets it.
 */
const KEY = "opendashboards:pending-prompt";

export function savePendingPrompt(prompt: string) {
  try {
    localStorage.setItem(KEY, prompt);
  } catch {
    // Storage is blocked: they sign in and write it again.
  }
}

export function clearPendingPrompt() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

function readPendingPrompt(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/** The saved prompt, or null; always null while rendering on the server. */
export function usePendingPrompt(): string | null {
  return useSyncExternalStore(subscribe, readPendingPrompt, () => null);
}
