const API_KEY_PATTERN = /ph[a-z]_[A-Za-z0-9_-]+/g;

/** Strips anything that looks like a PostHog key. */
export function redact(text: string): string {
  return text.replace(API_KEY_PATTERN, (key) => `${key.slice(0, 4)}[redacted]`);
}

/**
 * Logs an error by name, message and the same for each `cause` behind it
 * (a network failure's code, say), plus a `detail` an API gave. Whole error
 * objects can carry request bodies or headers, so they're never logged as is.
 */
export function logError(context: string, error: unknown): void {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    parts.push(describe(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  console.error(`[prism] ${context}: ${redact(parts.join(" ← caused by "))}`);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as { code?: unknown; detail?: unknown };
  const code = typeof extra.code === "string" ? ` [${extra.code}]` : "";
  const detail = typeof extra.detail === "string" && extra.detail ? ` (${extra.detail.slice(0, 300)})` : "";
  return `${error.name}: ${error.message}${code}${detail}`;
}
