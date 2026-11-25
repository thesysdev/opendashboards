import "server-only";

import { config, secrets } from "@/config";

/**
 * Composio's REST API, for the sources that sign in through it (Google Ads,
 * Meta Ads). Composio holds the ad platform's tokens, signed in with its own
 * approved OAuth apps; OpenDashboards holds only which Composio account is
 * whose, and calls Composio's tools on it.
 *
 * Only Composio's fixed API host is called, with our project key; redirects
 * are refused. Which tools may run is decided by each source, never here:
 * this only runs the tool a source names.
 */

import type { ComposioToolkit } from "./catalog";

export type { ComposioToolkit };

export type ComposioErrorCode =
  /** COMPOSIO_API_KEY or the toolkit's auth config isn't set on this deployment. */
  | "not_configured"
  /** Composio refused our project key. Our problem, not the user's. */
  | "project_rejected"
  /** The user's Composio account is gone, expired, revoked or failed: they sign in again. */
  | "reauth_required"
  /** The ad platform (through Composio) rejected the request itself: a bad query, an unknown field. */
  | "bad_request"
  | "rate_limited"
  | "timeout"
  /** Network error or 5xx. */
  | "unavailable"
  | "unexpected";

export class ComposioError extends Error {
  constructor(
    readonly code: ComposioErrorCode,
    /** The reason, from Composio or the ad platform. Shown for bad requests; logged otherwise. */
    readonly detail?: string,
    readonly toolkit?: ComposioToolkit,
  ) {
    super(`Composio request failed: ${code}${detail ? ` (${detail.slice(0, 300)})` : ""}`);
    this.name = "ComposioError";
  }
}

/** Tests only: replace fetch. */
export type ComposioDeps = { fetch?: typeof fetch; apiKey?: string; authConfigId?: string };

function apiKey(deps: ComposioDeps, toolkit?: ComposioToolkit): string {
  const key = deps.apiKey ?? secrets.composioApiKey();
  if (!key) throw new ComposioError("not_configured", "COMPOSIO_API_KEY is not set", toolkit);
  return key;
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal; timeoutMs?: number },
  deps: ComposioDeps,
  toolkit?: ComposioToolkit,
): Promise<T> {
  const key = apiKey(deps, toolkit);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? config().composio.checkTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${config().composio.apiUrl}${path}`, {
      method: init.method,
      headers: { "x-api-key": key, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    // A caller's own abort is theirs to handle; a timeout or network error isn't.
    if (init.signal?.aborted) throw error;
    throw new ComposioError(timeout.aborted ? "timeout" : "unavailable", (error as Error)?.message, toolkit);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw classify(response.status, body, path.startsWith("/connected_accounts/"), toolkit);
  return body as T;
}

/** Composio's error message, wherever it put it. */
function messageOf(body: unknown): string {
  if (!isRecord(body)) return "";
  const error = body.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof body.message === "string" ? body.message : "";
}

/** A connected account that can't be used any more reads as one: the user signs in again. */
const ACCOUNT_GONE = /connected[ _]?account.*(not found|inactive|expired|revoked|failed|deleted|disabled|not active)|(expired|revoked|invalid).*(token|credential|grant)|reauth/i;

/** `account`: the request was about one connected account, so a 404 means it's gone (elsewhere, it's ours: a wrong tool or version). */
function classify(status: number, body: unknown, account: boolean, toolkit?: ComposioToolkit): ComposioError {
  const message = messageOf(body).slice(0, 1_000);
  if (status === 401 || status === 403) {
    // A 401/403 about the connected account is the user's sign-in; about the key, it's ours.
    return ACCOUNT_GONE.test(message)
      ? new ComposioError("reauth_required", message, toolkit)
      : new ComposioError("project_rejected", message || `HTTP ${status}`, toolkit);
  }
  if ((status === 404 && account) || ACCOUNT_GONE.test(message)) return new ComposioError("reauth_required", message || "Account not found", toolkit);
  if (status === 429) return new ComposioError("rate_limited", message, toolkit);
  if (status === 400 || status === 422) return new ComposioError("bad_request", message || `HTTP ${status}`, toolkit);
  if (status >= 500) return new ComposioError("unavailable", message || `HTTP ${status}`, toolkit);
  return new ComposioError("unexpected", message || `HTTP ${status}`, toolkit);
}

/**
 * Starts a sign-in: Composio's hosted page, which sends the browser through
 * the ad platform's own OAuth and then to `callbackUrl`. The connected account
 * exists from now on (not yet active): its id is known before the browser
 * comes back, so the callback never has to trust an id in its URL.
 */
export async function createSignInLink(
  toolkit: ComposioToolkit,
  input: { composioUserId: string; callbackUrl: string },
  deps: ComposioDeps = {},
): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const authConfigId = deps.authConfigId ?? secrets.composioAuthConfig(toolkit);
  if (!authConfigId) throw new ComposioError("not_configured", `No Composio auth config for ${toolkit}`, toolkit);
  const body = await request<{ redirect_url?: unknown; connected_account_id?: unknown }>(
    "/connected_accounts/link",
    { method: "POST", body: { auth_config_id: authConfigId, user_id: input.composioUserId, callback_url: input.callbackUrl } },
    deps,
    toolkit,
  );
  if (typeof body?.redirect_url !== "string" || !/^https:\/\//.test(body.redirect_url) || typeof body.connected_account_id !== "string") {
    throw new ComposioError("unexpected", "The sign-in link response is missing its URL or account", toolkit);
  }
  return { redirectUrl: body.redirect_url, connectedAccountId: body.connected_account_id };
}

export type ComposioAccount = {
  id: string;
  /** ACTIVE, INITIATED, INACTIVE, FAILED, EXPIRED, REVOKED… */
  status: string;
  /** The Composio user it belongs to. Null when Composio didn't say, which no check accepts. */
  userId: string | null;
  /** The toolkit's slug, lowercase. Null when Composio didn't say, which no check accepts. */
  toolkit: string | null;
  disabled: boolean;
};

/** A connected account as Composio has it now. */
export async function getAccount(
  connectedAccountId: string,
  deps: ComposioDeps = {},
  signal?: AbortSignal,
  toolkit?: ComposioToolkit,
): Promise<ComposioAccount> {
  const body = await request<Record<string, unknown>>(`/connected_accounts/${encodeURIComponent(connectedAccountId)}`, { method: "GET", signal }, deps, toolkit);
  const slug = isRecord(body?.toolkit) ? body.toolkit.slug : body?.toolkit_slug;
  return {
    id: typeof body?.id === "string" ? body.id : connectedAccountId,
    status: typeof body?.status === "string" ? body.status.toUpperCase() : "UNKNOWN",
    userId: typeof body?.user_id === "string" ? body.user_id : null,
    toolkit: typeof slug === "string" ? slug.toLowerCase() : null,
    disabled: body?.is_disabled === true,
  };
}

/**
 * Lets go of a connected account: revokes its tokens at the ad platform
 * (best effort: not every platform supports it), then deletes it from
 * Composio. For a sign-in that didn't finish, a sign-out, a sign-in replaced,
 * or a connection removed.
 */
export async function deleteAccount(connectedAccountId: string, deps: ComposioDeps = {}): Promise<void> {
  const path = `/connected_accounts/${encodeURIComponent(connectedAccountId)}`;
  await request(`${path}/revoke`, { method: "POST", body: {} }, deps).catch(() => {});
  await request(path, { method: "DELETE" }, deps);
}

/**
 * The toolkit version every tool runs at: the one whose tools and arguments
 * were checked. A newer version can rename arguments or change results, so
 * it's adopted on purpose, not by Composio's "latest".
 */
export const TOOLKIT_VERSION = "20261116_00";

/** Who a tool runs as: one connected account of one Composio user. */
export type ComposioAccountRef = { composioUserId: string; connectedAccountId: string };

/**
 * Runs one Composio tool on the user's connected account and returns its
 * `data`. The tool's slug comes from the calling source's own fixed list.
 */
export async function runTool(
  toolkit: ComposioToolkit,
  slug: string,
  account: ComposioAccountRef,
  args: Record<string, unknown>,
  signal: AbortSignal,
  deps: ComposioDeps = {},
): Promise<unknown> {
  const body = await request<{ data?: unknown; error?: unknown; successful?: unknown }>(
    `/tools/execute/${encodeURIComponent(slug)}`,
    {
      method: "POST",
      body: { connected_account_id: account.connectedAccountId, user_id: account.composioUserId, version: TOOLKIT_VERSION, arguments: args },
      signal,
      // Meta builds large insight reports on demand.
      timeoutMs: config().composio.queryTimeoutMs,
    },
    deps,
    toolkit,
  );
  if (body?.successful !== true) {
    const message = typeof body?.error === "string" ? body.error : messageOf(body?.data);
    if (ACCOUNT_GONE.test(message)) throw new ComposioError("reauth_required", message, toolkit);
    if (/rate.?limit|too many requests|RESOURCE_EXHAUSTED|user request limit/i.test(message)) throw new ComposioError("rate_limited", message, toolkit);
    throw new ComposioError("bad_request", message || "The tool failed without saying why", toolkit);
  }
  return parseData(body.data);
}

/** Tool data, which Composio sometimes sends as a JSON string. */
function parseData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
