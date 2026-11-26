import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError as ProtocolError } from "@modelcontextprotocol/sdk/types.js";

import { OriginNotAllowedError, RedirectRefusedError, ResponseTooLargeError } from "@/lib/net/guarded-fetch";
import { BlockedAddressError, Ipv6OnlyHostError } from "@/lib/net/guarded-socket";

export type McpErrorCode =
  | "host_blocked"
  | "host_not_found"
  /** The host only has an IPv6 address, which we have no route to. */
  | "host_ipv6_only"
  | "unreachable"
  | "tls_failed"
  /** The server redirected, which is never followed. */
  | "redirected"
  /** Something tried to send a request outside the server's origin. */
  | "origin_refused"
  /** The server wants a key and none was given, or it wants OAuth. */
  | "auth_required"
  /** The key was refused. */
  | "key_rejected"
  /** An OAuth sign-in expired or was revoked: the user signs in again. */
  | "reauth_required"
  /** The server doesn't offer an OAuth sign-in OpenDashboards can use. */
  | "oauth_unsupported"
  /** The server's OAuth details failed a safety check. */
  | "oauth_invalid"
  /** The sign-in didn't complete. */
  | "oauth_failed"
  /** The key works but isn't allowed this. */
  | "access_denied"
  /** Not an MCP endpoint (404, 405, not JSON-RPC, no tools). */
  | "not_mcp"
  /** The arguments didn't fit the tool, or there's no such tool. */
  | "bad_arguments"
  /** The tool ran and reported a failure. */
  | "tool_error"
  /** The server says the tool changes data: OpenDashboards only reads. */
  | "tool_not_allowed"
  | "too_large"
  | "timeout"
  /** The server is limiting requests: trying again straight away only extends it. */
  | "rate_limited"
  | "unavailable"
  | "unexpected";

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    /** The server's message, trimmed. Shown to the agent for tool and argument errors; logs otherwise. */
    readonly detail?: string,
  ) {
    super(`MCP request failed: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "McpError";
  }
}

const NETWORK_UNREACHABLE = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);
const TLS_CODES = /^(ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_|CERT_|HOSTNAME_MISMATCH)/;

const trim = (text: string | undefined) => text?.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;

/** The SDK's "Unexpected content type: text/html; charset=utf-8", in words. */
function answeredWith(message: string): string {
  const type = /Unexpected content type:\s*([^;\s]*)/i.exec(message)?.[1]?.toLowerCase() ?? "";
  if (type === "text/html") return "it answered with a web page";
  return type ? `it answered with ${type}, not JSON` : "its reply wasn't JSON";
}

/**
 * Classifies whatever the SDK, undici or our guards threw. The SDK wraps
 * transport failures, so the cause chain is searched for the real reason.
 */
export function toMcpError(error: unknown, { hasKey }: { hasKey: boolean }): McpError {
  const chain: unknown[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) chain.push(e);

  for (const e of chain) {
    if (e instanceof McpError) return e;
    if (e instanceof BlockedAddressError) return new McpError("host_blocked", e.message);
    if (e instanceof Ipv6OnlyHostError) return new McpError("host_ipv6_only", e.message);
    if (e instanceof OriginNotAllowedError) return new McpError("origin_refused");
    if (e instanceof RedirectRefusedError) return new McpError("redirected", e.message);
    if (e instanceof ResponseTooLargeError) return new McpError("too_large", e.message);
  }
  for (const e of chain) {
    if (e instanceof UnauthorizedError) return new McpError(hasKey ? "key_rejected" : "auth_required", trim(e.message));
    if (e instanceof StreamableHTTPError) {
      if (e.code === 401) return new McpError(hasKey ? "key_rejected" : "auth_required", trim(e.message));
      if (e.code === 403) return new McpError("access_denied", trim(e.message));
      // The body of a 404 or a wrong content type is usually a web page: say what happened, not what it said.
      if (e.code === 404 || e.code === 405 || e.code === 406 || e.code === 415) return new McpError("not_mcp", `it answered HTTP ${e.code}`);
      if (e.code === -1 && /Unexpected content type/i.test(e.message)) return new McpError("not_mcp", answeredWith(e.message));
      if (e.code === 429) return new McpError("rate_limited");
      if (e.code !== undefined && e.code >= 500) return new McpError("unavailable", trim(e.message));
    }
    if (e instanceof ProtocolError) {
      switch (e.code) {
        case ErrorCode.RequestTimeout:
          return new McpError("timeout", trim(e.message));
        case ErrorCode.MethodNotFound:
          return new McpError("not_mcp", "The server doesn't offer tools.");
        case ErrorCode.InvalidParams:
          return new McpError("bad_arguments", trim(e.message));
        case ErrorCode.ConnectionClosed:
          return new McpError("unavailable", trim(e.message));
        case ErrorCode.ParseError:
        case ErrorCode.InvalidRequest:
          return new McpError("not_mcp", trim(e.message));
        default:
          return new McpError("tool_error", trim(e.message));
      }
    }
  }
  for (const e of chain) {
    const err = e as { code?: unknown; name?: unknown; message?: unknown };
    const code = typeof err?.code === "string" ? err.code : "";
    const message = typeof err?.message === "string" ? err.message : "";
    if (err?.name === "TimeoutError" || err?.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
      return new McpError("timeout");
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME") return new McpError("host_not_found");
    if (TLS_CODES.test(code)) return new McpError("tls_failed", message);
    if (NETWORK_UNREACHABLE.has(code)) return new McpError("unreachable", message);
    if (err?.name === "SyntaxError") return new McpError("not_mcp", "its reply wasn't JSON");
    // JSON, but not a JSON-RPC message: the SDK's schema check fails with the issues as raw JSON.
    if (err?.name === "ZodError") return new McpError("not_mcp", "its reply was JSON, but not MCP");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new McpError("unexpected", trim(message));
}
