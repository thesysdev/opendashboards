"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/user";
import { getAppService } from "@/lib/apps";
import type { AppResult } from "@/lib/apps/errors";

/*
 * Public POST endpoints like every Server Action: each authenticates itself,
 * and the service validates input and scopes everything to the user.
 *
 * Successful changes revalidate the shared layout, not just the page: the
 * sidebar's "Recent" list shows app names too.
 */

const revalidateShell = () => revalidatePath("/", "layout");

/** Creates the app and opens it. Returns only on failure. */
export async function createAppAction(input: unknown): Promise<AppResult<never>> {
  const user = await requireUser();
  const result = await getAppService().create(user.id, input);
  if (!result.ok) return result;
  revalidateShell();
  redirect(`/apps/${result.data.id}`);
}

export async function renameAppAction(input: unknown): Promise<AppResult> {
  const user = await requireUser();
  const result = await getAppService().rename(user.id, input);
  if (result.ok) revalidateShell();
  return result;
}

/** Deletes the app and goes back to the list. Returns only on failure. */
export async function deleteAppAction(input: unknown): Promise<AppResult<never>> {
  const user = await requireUser();
  const result = await getAppService().remove(user.id, input);
  if (!result.ok) return result;
  revalidateShell();
  redirect("/apps");
}
