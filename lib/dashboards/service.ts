import { and, count, eq } from "drizzle-orm";

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
