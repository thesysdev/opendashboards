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
    /** Composio's id for the failed request (its request_id, or a tool run's log_id), for their support. Logged (it's in the message), never shown. */
    readonly requestId?: string,
  ) {
    super(`Composio request failed: ${code}${detail ? ` (${detail.slice(0, 300)})` : ""}${requestId ? ` [request_id ${requestId}]` : ""}`);
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

/** Whether this deployment can sign in to `toolkit` through Composio: the project key and that toolkit's auth config are set. */
export function isConfigured(toolkit: ComposioToolkit): boolean {
  return Boolean(secrets.composioApiKey() && secrets.composioAuthConfig(toolkit));
}

async function request<T>(
  path: string,
  init: {
    method: "GET" | "POST" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** False: a failure's wording never makes it `reauth_required` (the caller asks the account instead). */
    wording?: boolean;
  },
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
  if (!response.ok) throw classify(response.status, body, path.startsWith("/connected_accounts/"), toolkit, init.wording ?? true);
  return body as T;
}

/** Composio's id for a failed request, if it gave one: `{ error: { request_id } }`. */
function requestIdOf(body: unknown): string | undefined {
  return asId(isRecord(body) ? (isRecord(body.error) ? body.error.request_id : body.request_id) : undefined);
}

/** An id Composio sent, kept only when it looks like one: it goes into log lines. */
function asId(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.:-]{1,100}$/.test(value) ? value : undefined;
}

/** Composio's error message, wherever it put it. */
function messageOf(body: unknown): string {
  if (!isRecord(body)) return "";
  const error = body.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof body.message === "string" ? body.message : "";
}

/**
 * Wording that says a connected account can't be used any more. Only a
 * fallback: Composio's errors carry no codes, so whether a failed tool run
 * means signing in again is decided by the account's status (`runTool`), and
 * this is read only when that can't be looked up. Includes Meta's expired
 * token (OAuthException 190): "Error validating access token: Session has
 * expired…".
 */
const ACCOUNT_GONE =
  /connected[ _]?account.*(not found|inactive|expired|revoked|failed|deleted|disabled|not active)|(expired|revoked|invalid).*(token|credential|grant)|validating access token|session has expired|reauth/i;

/**
 * `account`: the request was about one connected account, so a 404 means it's
 * gone (elsewhere, it's ours: a wrong tool or version). `wording`: whether the
 * message alone may say the sign-in is lost (see ACCOUNT_GONE).
 */
function classify(status: number, body: unknown, account: boolean, toolkit?: ComposioToolkit, wording = true): ComposioError {
  const message = messageOf(body).slice(0, 1_000);
  const requestId = requestIdOf(body);
  const error = (code: ComposioErrorCode, detail: string) => new ComposioError(code, detail, toolkit, requestId);
  const gone = wording && ACCOUNT_GONE.test(message);
  if (status === 401 || status === 403) {
    // A 401/403 about the connected account is the user's sign-in; about the key, it's ours.
    return gone ? error("reauth_required", message) : error("project_rejected", message || `HTTP ${status}`);
  }
  if ((status === 404 && account) || gone) return error("reauth_required", message || "Account not found");
  if (status === 429) return error("rate_limited", message);
  if (status === 400 || status === 422) return error("bad_request", message || `HTTP ${status}`);
  if (status >= 500) return error("unavailable", message || `HTTP ${status}`);
  return error("unexpected", message || `HTTP ${status}`);
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

/**
 * A connected account as Composio has it now. `wording`: false when only a
 * 404 may say the account is gone, not a failure's text (see ACCOUNT_GONE).
 */
export async function getAccount(
  connectedAccountId: string,
  deps: ComposioDeps = {},
  signal?: AbortSignal,
  toolkit?: ComposioToolkit,
  wording = true,
): Promise<ComposioAccount> {
  const body = await request<Record<string, unknown>>(`/connected_accounts/${encodeURIComponent(connectedAccountId)}`, { method: "GET", signal, wording }, deps, toolkit);
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
 *
 * A failure that could be a lost sign-in is checked against the account
 * itself (`lostSignIn`), since Composio's errors carry no codes.
 */
export async function runTool(
  toolkit: ComposioToolkit,
  slug: string,
  account: ComposioAccountRef,
  args: Record<string, unknown>,
  signal: AbortSignal,
  deps: ComposioDeps = {},
): Promise<unknown> {
  let body: { data?: unknown; error?: unknown; successful?: unknown; log_id?: unknown };
  try {
    body = await request(
      `/tools/execute/${encodeURIComponent(slug)}`,
      {
        method: "POST",
        body: { connected_account_id: account.connectedAccountId, user_id: account.composioUserId, version: TOOLKIT_VERSION, arguments: args },
        signal,
        // Meta builds large insight reports on demand.
        timeoutMs: config().composio.queryTimeoutMs,
        wording: false,
      },
      deps,
      toolkit,
    );
  } catch (error) {
    // A timeout, an outage or a rate limit isn't the sign-in: no need to ask.
    if (!(error instanceof ComposioError) || !MAYBE_SIGN_IN.has(error.code)) throw error;
    throw await lostSignIn(error, account, signal, deps, toolkit);
  }
  if (body?.successful !== true) {
    const message = typeof body?.error === "string" ? body.error : messageOf(body?.data);
    const requestId = asId(body?.log_id) ?? requestIdOf(body);
    const failed = (code: ComposioErrorCode, detail: string) => new ComposioError(code, detail, toolkit, requestId);
    if (/rate.?limit|too many requests|RESOURCE_EXHAUSTED|user request limit/i.test(message)) throw failed("rate_limited", message);
    throw await lostSignIn(failed("bad_request", message || "The tool failed without saying why"), account, signal, deps, toolkit);
  }
  return parseData(body.data);
}

/** Failures that may be a lost sign-in, which the account's status settles. */
const MAYBE_SIGN_IN = new Set<ComposioErrorCode>(["bad_request", "project_rejected", "unexpected"]);

/** Account statuses that mean it can't run tools until the user signs in again. */
const SIGNED_OUT = new Set(["EXPIRED", "REVOKED", "INACTIVE"]);

/**
 * What a failed tool run means, asked of the account itself (a GET, on the
 * short check timeout): expired, revoked, inactive, disabled or gone is a
 * lost sign-in; active means the failure is what it says (a bad query, say),
 * whatever its wording. Only when the account can't be looked up, or is in
 * some other state, does the wording decide (ACCOUNT_GONE).
 */
async function lostSignIn(
  failure: ComposioError,
  account: ComposioAccountRef,
  signal: AbortSignal,
  deps: ComposioDeps,
  toolkit: ComposioToolkit,
): Promise<ComposioError> {
  const signedOut = (why: string) => new ComposioError("reauth_required", `${why}: ${failure.detail ?? failure.code}`, toolkit, failure.requestId);
  let found: ComposioAccount;
  try {
    found = await getAccount(account.connectedAccountId, deps, signal, toolkit, false);
  } catch (lookup) {
    // A 404 on the account: it's gone.
    if (lookup instanceof ComposioError && lookup.code === "reauth_required") return signedOut("The account is gone");
    return byWording(failure, toolkit);
  }
  if (found.disabled || SIGNED_OUT.has(found.status)) return signedOut(`The account is ${found.disabled ? "disabled" : found.status.toLowerCase()}`);
  if (found.status === "ACTIVE") return failure;
  return byWording(failure, toolkit);
}

/** The fallback: the failure, unless its wording says the sign-in is lost. */
function byWording(failure: ComposioError, toolkit: ComposioToolkit): ComposioError {
  return ACCOUNT_GONE.test(failure.detail ?? "") ? new ComposioError("reauth_required", failure.detail, toolkit, failure.requestId) : failure;
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
