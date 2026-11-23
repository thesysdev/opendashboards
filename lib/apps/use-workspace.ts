"use client";

import { useParams } from "next/navigation";

/**
 * The workspace of the page this is on, from its address (/w/<id>/…). What a
 * form creates goes there, whatever workspace another tab has open.
 */
export function useWorkspaceId(): string {
  const { orgId } = useParams<{ orgId?: string }>();
  if (typeof orgId !== "string") throw new Error("useWorkspaceId is only for pages under /w/[orgId]");
  return orgId;
}
