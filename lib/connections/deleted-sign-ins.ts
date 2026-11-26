import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { connectionSignIns, dataConnections, pendingSignIns } from "@/lib/db/schema";

/**
 * Sign-ins deleted here, for their sources to let go of what they held
 * elsewhere once the delete commits (the connection service's
 * `releaseDeleted`): finished ones, each with its connection's type, and
 * unfinished ones, e.g. a Composio account made for a sign-in nobody finished.
 */
export type DeletedSignIns = {
  signIns: { type: (typeof dataConnections.$inferSelect)["type"]; signIn: typeof connectionSignIns.$inferSelect }[];
  pending: (typeof pendingSignIns.$inferSelect)[];
};

type Tx = Pick<Database, "select" | "delete">;

/**
 * Deletes the sign-ins in a workspace, finished and not: everyone's, or only
 * `userId`'s. For a member leaving or a workspace deleted, inside its
 * transaction; release what this returns once it commits.
 */
export async function deleteSignIns(tx: Tx, { orgId, userId }: { orgId: string; userId?: string }): Promise<DeletedSignIns> {
  const signIns = await tx
    .select({ type: dataConnections.type, signIn: connectionSignIns })
    .from(connectionSignIns)
    .innerJoin(dataConnections, eq(dataConnections.id, connectionSignIns.connectionId))
    .where(and(eq(dataConnections.orgId, orgId), userId ? eq(connectionSignIns.userId, userId) : undefined));
  if (signIns.length) await tx.delete(connectionSignIns).where(inArray(connectionSignIns.id, signIns.map(({ signIn }) => signIn.id)));
  const pending = await tx
    .delete(pendingSignIns)
    .where(and(eq(pendingSignIns.orgId, orgId), userId ? eq(pendingSignIns.userId, userId) : undefined))
    .returning();
  return { signIns, pending };
}
