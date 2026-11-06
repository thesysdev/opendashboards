import { and, asc, count, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { apps, dashboards } from "@/lib/db/schema";

/**
 * Prism's record of dashboards: which app each OpenUI Cloud artifact belongs
 * to. Cloud keeps the dashboard itself; this table gives it an app, a title
 * for the sidebar, and an owner check before its data loads. Every query is
 * scoped to the user.
 */
export function createDashboardService({ db }: { db: Database }) {
  return {
    /**
     * Records a dashboard the agent created in this app, or retitles it if it
     * exists. Returns null if the app isn't this user's.
     */
    async record(
      userId: string,
      appId: string,
      { artifactId, title }: { artifactId: string; title: string },
    ): Promise<{ id: string } | null> {
      const [app] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.id, appId), eq(apps.userId, userId)))
        .limit(1);
      if (!app) return null;

      const [existing] = await db
        .select({ id: dashboards.id, appId: dashboards.appId })
        .from(dashboards)
        .where(and(eq(dashboards.artifactId, artifactId), eq(dashboards.userId, userId)))
        .limit(1);
      if (existing) {
        if (existing.appId !== appId) return null;
        await db.update(dashboards).set({ title }).where(eq(dashboards.id, existing.id));
        return { id: existing.id };
      }

      const [{ position }] = await db
        .select({ position: count(dashboards.id) })
        .from(dashboards)
        .where(eq(dashboards.appId, appId));
      const [created] = await db
        .insert(dashboards)
        .values({ appId, userId, artifactId, title, position })
        .returning({ id: dashboards.id });
      return created;
    },

    /**
     * Removes the app's record of a dashboard and closes the gap in the
     * sidebar order. Returns false if it isn't this user's dashboard in that app.
     */
    async remove(userId: string, appId: string, artifactId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [removed] = await tx
          .delete(dashboards)
          .where(
            and(eq(dashboards.artifactId, artifactId), eq(dashboards.appId, appId), eq(dashboards.userId, userId)),
          )
          .returning({ position: dashboards.position });
        if (!removed) return false;
        await tx
          .update(dashboards)
          .set({ position: sql`${dashboards.position} - 1` })
          .where(and(eq(dashboards.appId, appId), gt(dashboards.position, removed.position)));
        return true;
      });
    },

    /** The app's dashboards, in sidebar order, if the app is this user's. */
    async list(userId: string, appId: string): Promise<{ id: string; artifactId: string; title: string }[]> {
      return db
        .select({ id: dashboards.id, artifactId: dashboards.artifactId, title: dashboards.title })
        .from(dashboards)
        .where(and(eq(dashboards.appId, appId), eq(dashboards.userId, userId)))
        .orderBy(asc(dashboards.position));
    },

    /** The app a dashboard belongs to, if it's this user's. */
    async findByArtifact(userId: string, artifactId: string): Promise<{ id: string; appId: string } | null> {
      const [row] = await db
        .select({ id: dashboards.id, appId: dashboards.appId })
        .from(dashboards)
        .where(and(eq(dashboards.artifactId, artifactId), eq(dashboards.userId, userId)))
        .limit(1);
      return row ?? null;
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
