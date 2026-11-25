import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { connectionSignIns, dataConnections, mcpOAuthSignIns } from "@/lib/db/schema";

/**
 * Finished sign-ins deleted here, each with its connection's type, for their
 * sources to let go of what they held elsewhere (the connection service's
 * `releaseDeleted`): a Composio account, with its ad platform tokens.
 */
export type DeletedSignIns = { type: (typeof dataConnections.$inferSelect)["type"]; signIn: typeof connectionSignIns.$inferSelect }[];

type Tx = Pick<Database, "select" | "delete">;

/**
 * Deletes the sign-ins in a workspace, finished and not: everyone's, or only
 * `userId`'s. For a member leaving or a workspace deleted, inside its
 * transaction; release what this returns once it commits. Unfinished ones
 * hold nothing to release: Composio times out a link not completed in 10
 * minutes.
 */
export async function deleteSignIns(tx: Tx, { orgId, userId }: { orgId: string; userId?: string }): Promise<DeletedSignIns> {
  const signIns = await tx
    .select({ type: dataConnections.type, signIn: connectionSignIns })
    .from(connectionSignIns)
    .innerJoin(dataConnections, eq(dataConnections.id, connectionSignIns.connectionId))
    .where(and(eq(dataConnections.orgId, orgId), userId ? eq(connectionSignIns.userId, userId) : undefined));
  if (signIns.length) await tx.delete(connectionSignIns).where(inArray(connectionSignIns.id, signIns.map(({ signIn }) => signIn.id)));
  await tx.delete(mcpOAuthSignIns).where(and(eq(mcpOAuthSignIns.orgId, orgId), userId ? eq(mcpOAuthSignIns.userId, userId) : undefined));
  return signIns;
}
