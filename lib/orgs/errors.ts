import type { z } from "zod";

export type OrgErrorCode = "validation" | "not_found" | "forbidden" | "conflict" | "internal";

export type OrgError = { code: OrgErrorCode; message: string; field?: string };

export type OrgResult<T = undefined> = { ok: true; data: T } | { ok: false; error: OrgError };

export const ok = <T>(data: T): OrgResult<T> => ({ ok: true, data });
export const fail = (error: OrgError): OrgResult<never> => ({ ok: false, error });

/** Not a member, or no such workspace: the two look the same from outside. */
export const notFound = (): OrgResult<never> => fail({ code: "not_found", message: "This workspace doesn't exist, or you aren't a member." });

export const forbidden = (message = "Only an admin of this workspace can do that."): OrgResult<never> => fail({ code: "forbidden", message });

export const internalError = (): OrgResult<never> => fail({ code: "internal", message: "Something went wrong. Try again." });

export function fromValidation(error: z.ZodError): OrgResult<never> {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return fail({
    code: "validation",
    message: issue?.message ?? "Check the form and try again.",
    field: typeof field === "string" ? field : undefined,
  });
}
