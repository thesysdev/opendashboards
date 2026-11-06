import type { z } from "zod";

import type { ConnectionStatus } from "@/lib/db/schema";
import { PostgresError } from "@/lib/postgres/errors";
import { PostHogError } from "@/lib/posthog/client";
import {
  NotImplementedError,
  SecretProviderMismatchError,
  SecretStorageNotConfiguredError,
} from "@/lib/secrets";

const FIELDS = [
  "name",
  // PostHog
  "hostKind",
  "projectId",
  "apiKey",
  // Postgres
  "host",
  "port",
  "database",
  "user",
  "password",
  "sslMode",
] as const;

export type ConnectionField = (typeof FIELDS)[number];

export type ConnectionErrorCode =
  | "validation"
  | "not_found"
  | "in_use"
  // PostHog
  | "invalid_key"
  | "missing_scope"
  | "project_forbidden"
  | "project_not_found"
  | "rate_limited"
  | "posthog_unavailable"
  | "posthog_unexpected"
  // Postgres
  | "auth_failed"
  | "database_not_found"
  | "permission_denied"
  | "host_blocked"
  | "host_not_found"
  | "unreachable"
  | "timeout"
  | "tls_failed"
  | "postgres_unexpected"
  // Secrets
  | "key_reentry_required"
  | "secret_storage_unavailable"
  | "internal";

export type ConnectionError = {
  code: ConnectionErrorCode;
  message: string;
  /** The form field the message belongs under, when there is one. */
  field?: ConnectionField;
  /** For `in_use`: the apps that use the connection. */
  apps?: { id: string; name: string }[];
};

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: ConnectionError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: ConnectionError): Result<never> => ({ ok: false, error });

export const notFound = (): Result<never> =>
  fail({ code: "not_found", message: "This connection doesn't exist or was deleted." });

/** `fieldFor` maps a schema path to a form field when they differ (a credential). */
export function fromValidation(
  error: z.ZodError,
  fieldFor: (path: PropertyKey | undefined) => ConnectionField | undefined = (path) =>
    isField(path) ? path : undefined,
): Result<never> {
  const issue = error.issues[0];
  return fail({
    code: "validation",
    message: issue?.message ?? "Check the form and try again.",
    field: fieldFor(issue?.path[0]),
  });
}

/** Turns a failed check (PostHog, Postgres or secret storage) into a user-facing error. */
export function fromCheckError(error: unknown): ConnectionError | null {
  if (error instanceof PostHogError) return fromPostHog(error);
  if (error instanceof PostgresError) return fromPostgres(error);
  if (error instanceof SecretProviderMismatchError) {
    return {
      code: "key_reentry_required",
      message: "This credential was stored by a different setup and can't be used here. Enter it again.",
    };
  }
  if (error instanceof NotImplementedError || error instanceof SecretStorageNotConfiguredError) {
    return {
      code: "secret_storage_unavailable",
      message: "Secret storage isn't set up on this server yet, so credentials can't be saved or used.",
    };
  }
  return null;
}

function fromPostHog(error: PostHogError): ConnectionError {
  switch (error.code) {
    case "invalid_key":
      return {
        code: "invalid_key",
        field: "apiKey",
        message: "PostHog didn't accept this key. Check that it's a personal API key that hasn't been revoked.",
      };
    case "missing_scope":
      return {
        code: "missing_scope",
        field: "apiKey",
        message: "This key doesn't have the Query Read permission. Create a key with Query Read for this project.",
      };
    case "project_forbidden":
      return {
        code: "project_forbidden",
        field: "projectId",
        message: "This key can't access that project. Check the project ID, or scope the key to this project.",
      };
    case "project_not_found":
      return {
        code: "project_not_found",
        field: "projectId",
        message: "There's no project with this ID in this region. Check the ID and the region.",
      };
    case "rate_limited":
      return { code: "rate_limited", message: "PostHog is rate-limiting requests right now. Try again in a minute." };
    case "unavailable":
      return { code: "posthog_unavailable", message: "Couldn't reach PostHog. Try again." };
    case "unexpected":
      return { code: "posthog_unexpected", message: "PostHog sent an unexpected response. Try again." };
  }
}

function fromPostgres(error: PostgresError): ConnectionError {
  switch (error.code) {
    case "auth_failed":
      return {
        code: "auth_failed",
        field: "password",
        message: "Postgres didn't accept this user and password. If they're right, the server may not allow logins from Prism's address.",
      };
    case "database_not_found":
      return { code: "database_not_found", field: "database", message: "There's no database with this name on the server." };
    case "permission_denied":
      return { code: "permission_denied", field: "user", message: "This user isn't allowed to connect to that database." };
    case "host_blocked":
      return {
        code: "host_blocked",
        field: "host",
        message: "This host points to a private or reserved address. Prism only connects to databases reachable on the public internet.",
      };
    case "host_not_found":
      return { code: "host_not_found", field: "host", message: "This host name doesn't resolve. Check it for typos." };
    case "unreachable":
      return {
        code: "unreachable",
        field: "host",
        message: "Couldn't reach the server. Check the host and port, and that the database accepts connections from Prism.",
      };
    case "timeout":
      return {
        code: "timeout",
        field: "host",
        message: "The server didn't answer in time. Check the host and port, or allowlist Prism's address in your firewall.",
      };
    case "tls_failed":
      return {
        code: "tls_failed",
        field: "sslMode",
        message: "Couldn't set up an encrypted connection. If the server's certificate can't be verified, choose \"Encrypt only\".",
      };
    case "unexpected":
      return { code: "postgres_unexpected", message: "Postgres returned an unexpected error. Try again." };
  }
}

/** The status a connection gets after a failed check. */
export function statusFor(code: ConnectionErrorCode): ConnectionStatus {
  switch (code) {
    case "invalid_key":
    case "missing_scope":
    case "project_forbidden":
    case "project_not_found":
    case "key_reentry_required":
    case "auth_failed":
    case "database_not_found":
    case "permission_denied":
    case "host_blocked":
    case "host_not_found":
    case "tls_failed":
      return "invalid";
    default:
      return "unavailable";
  }
}

export const internalError = (): Result<never> =>
  fail({ code: "internal", message: "Something went wrong. Try again." });

function isField(value: unknown): value is ConnectionField {
  return (FIELDS as readonly unknown[]).includes(value);
}
