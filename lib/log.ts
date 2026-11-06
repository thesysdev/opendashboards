const API_KEY_PATTERN = /ph[a-z]_[A-Za-z0-9_-]+/g;

/** Strips anything that looks like a PostHog key. */
export function redact(text: string): string {
  return text.replace(API_KEY_PATTERN, (key) => `${key.slice(0, 4)}[redacted]`);
}

/**
 * Logs an error by name and message only. Whole error objects can carry
 * request bodies or headers, so they're never logged as is.
 */
export function logError(context: string, error: unknown): void {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "unknown");
  console.error(`[prism] ${context}: ${redact(detail)}`);
}
