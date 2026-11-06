import type { z } from "zod";

import type { ConnectionStatus } from "@/lib/db/schema";
import { PostHogError } from "@/lib/posthog/client";
import {
  NotImplementedError,
  SecretProviderMismatchError,
  SecretStorageNotConfiguredError,
} from "@/lib/secrets";

export type ConnectionField = "name" | "hostKind" | "projectId" | "apiKey";

export type ConnectionErrorCode =
  | "validation"
  | "not_found"
  | "in_use"
  | "invalid_key"
  | "missing_scope"
  | "project_forbidden"
  | "project_not_found"
  | "rate_limited"
  | "posthog_unavailable"
  | "posthog_unexpected"
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

export function fromValidation(error: z.ZodError): Result<never> {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return fail({
    code: "validation",
    message: issue?.message ?? "Check the form and try again.",
    field: isField(field) ? field : undefined,
  });
}

/** Turns a failed check (PostHog or secret storage) into a user-facing error. */
export function fromCheckError(error: unknown): ConnectionError | null {
  if (error instanceof PostHogError) {
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
        return {
          code: "rate_limited",
          message: "PostHog is rate-limiting requests right now. Try again in a minute.",
        };
      case "unavailable":
        return { code: "posthog_unavailable", message: "Couldn't reach PostHog. Try again." };
      case "unexpected":
        return {
          code: "posthog_unexpected",
          message: "PostHog sent an unexpected response. Try again.",
        };
    }
  }
  if (error instanceof SecretProviderMismatchError) {
    return {
      code: "key_reentry_required",
      field: "apiKey",
      message: "This key was stored by a different setup and can't be used here. Replace the key.",
    };
  }
  if (error instanceof NotImplementedError || error instanceof SecretStorageNotConfiguredError) {
    return {
      code: "secret_storage_unavailable",
      message: "Secret storage isn't set up on this server yet, so keys can't be saved or used.",
    };
  }
  return null;
}

/** The status a connection gets after a failed check. */
export function statusFor(code: ConnectionErrorCode): ConnectionStatus {
  switch (code) {
    case "invalid_key":
    case "missing_scope":
    case "project_forbidden":
    case "project_not_found":
    case "key_reentry_required":
      return "invalid";
    default:
      return "unavailable";
  }
}

export const internalError = (): Result<never> =>
  fail({ code: "internal", message: "Something went wrong. Try again." });

function isField(value: unknown): value is ConnectionField {
  return value === "name" || value === "hostKind" || value === "projectId" || value === "apiKey";
}
