import { count } from "./metrics";

const API_KEY_PATTERN = /ph[a-z]_[A-Za-z0-9_-]+/g;
const URL_PASSWORD_PATTERN = /(:\/\/[^\s:/@]*):[^\s/@]*@/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/** Strips anything that looks like a PostHog key, a connection string's password or a token. */
export function redact(text: string): string {
  return text
    .replace(API_KEY_PATTERN, (key) => `${key.slice(0, 4)}[redacted]`)
    .replace(URL_PASSWORD_PATTERN, "$1:[redacted]@")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted-jwt]");
}

/**
 * Logs an error by name, message and the same for each `cause` behind it
 * (a network failure's code, say), plus a `detail` an API gave. Whole error
 * objects can carry request bodies or headers, so they're never logged as is.
 * Each one also counts toward the `opendashboards.error` metric, which Vercel alerts on.
 */
export function logError(context: string, error: unknown): void {
  const parts: string[] = [];
  let current: unknown = error;
  let rootCause: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    parts.push(describe(current));
    rootCause = current;
    current = current instanceof Error ? current.cause : undefined;
  }
  console.error(`[opendashboards] ${context}: ${redact(parts.join(" ← caused by "))}`);
  count("opendashboards.error", { context, cause: causeLabel(rootCause) });
}

/** A low-cardinality name for a failure: a code (`ECONNREFUSED`, `23505`) or the error's name. */
function causeLabel(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const { code } = error as { code?: unknown };
  return typeof code === "string" && code ? code : error.name;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as { code?: unknown; detail?: unknown };
  const code = typeof extra.code === "string" ? ` [${extra.code}]` : "";
  const detail = typeof extra.detail === "string" && extra.detail ? ` (${extra.detail.slice(0, 300)})` : "";
  return `${error.name}: ${error.message}${code}${detail}`;
}
