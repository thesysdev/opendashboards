import { parseMessage } from "@openuidev/lang-core";

/**
 * The dashboard a create/edit response is for, and the version it writes, read
 * as OpenUI Cloud writes it: a sentence plus a content line, parsed with the
 * parser LiveArtifactRenderer reads it with. Client-safe.
 */
export function referenceOf(response: string | null | undefined): { id: string; version?: string } | null {
  if (!response) return null;
  const { artifact_id: id, version } = parseMessage(response).attributes;
  if (typeof id !== "string" || !id) return null;
  return { id, version: typeof version === "string" && version ? version : undefined };
}
