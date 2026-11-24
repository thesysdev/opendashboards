import { and, asc, count, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { appAccess, appFacts, type AppGrant } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";
import { OPEN_GATE, type Gate } from "@/lib/entitlements";

/**
 * OpenDashboards' record of dashboards: which app each OpenUI Cloud artifact belongs
 * to. Cloud keeps the dashboard itself; this table gives it an app, a title
 * for the sidebar, and an access check before its data loads. A dashboard
 * follows its app: whoever can open the app can open it, and whoever can
 * change the app can change it. `user_id` is who created it.
 */
export function createDashboardService({ db, gate = OPEN_GATE }: { db: Database; gate?: Gate }) {
  return {
    /**
     * Records a dashboard the agent created in this app, with its title and
     * description (or sets them again if it's already recorded). Returns null
     * if the caller can't change the app.
     */
    async record(
      userId: string,
      appId: string,
      { artifactId, title, description = null }: { artifactId: string; title: string; description?: string | null },
    ): Promise<{ id: string } | null> {
      if (!can("dashboard", "create", (await appFacts(db, userId, appId))?.facts ?? null)) return null;
      const [existing] = await db
        .select({ id: dashboards.id, appId: dashboards.appId })
        .from(dashboards)
        .where(eq(dashboards.artifactId, artifactId))
        .limit(1);
      if (existing) {
        if (existing.appId !== appId) return null;
        await db.update(dashboards).set({ title, description }).where(eq(dashboards.id, existing.id));
        return { id: existing.id };
      }

      const [{ position }] = await db
        .select({ position: count(dashboards.id) })
        .from(dashboards)
        .where(eq(dashboards.appId, appId));
      const [created] = await db
        .insert(dashboards)
        .values({ appId, userId, artifactId, title, description, position })
        .returning({ id: dashboards.id });
      return created;
    },

    /**
     * Removes the app's record of a dashboard and closes the gap in the
     * sidebar order. Returns false if the caller can't change that app, or it has no such dashboard.
     */
    async remove(userId: string, appId: string, artifactId: string): Promise<boolean> {
      if (!can("dashboard", "delete", (await appFacts(db, userId, appId))?.facts ?? null)) return false;
      return db.transaction(async (tx) => {
        const [removed] = await tx
          .delete(dashboards)
          .where(
            and(eq(dashboards.artifactId, artifactId), eq(dashboards.appId, appId)),
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

    /**
     * Changes a dashboard's title or description, as the user asked. A null
     * description clears it. Returns false if the caller can't change that app,
     * or it has no such dashboard.
     */
    async update(
      userId: string,
      appId: string,
      dashboardId: string,
      changes: { title?: string; description?: string | null },
    ): Promise<boolean> {
      const app = await appFacts(db, userId, appId);
      if (!can("dashboard", "rename", app?.facts ?? null)) return false;
      // A view-only workspace keeps its dashboards as they are.
      if (await gate(db, app!.orgId, "editDashboard")) return false;
      const renamed = await db
        .update(dashboards)
        .set(changes)
        .where(and(eq(dashboards.id, dashboardId), eq(dashboards.appId, appId)))
        .returning({ id: dashboards.id });
      return renamed.length > 0;
    },

    /** The app's dashboards, in sidebar order, if the caller can open the app. */
    async list(
      userId: string,
      appId: string,
    ): Promise<{ id: string; artifactId: string; title: string; description: string | null }[]> {
      if (!can("dashboard", "view", (await appFacts(db, userId, appId))?.facts ?? null)) return [];
      return db
        .select({
          id: dashboards.id,
          artifactId: dashboards.artifactId,
          title: dashboards.title,
          description: dashboards.description,
        })
        .from(dashboards)
        .where(eq(dashboards.appId, appId))
        .orderBy(asc(dashboards.position));
    },

    /** The dashboard for an OpenUI Cloud artifact and what the caller may do in its app, if they can open it. */
    async findByArtifact(userId: string, artifactId: string): Promise<{ id: string; appId: string; grant: AppGrant } | null> {
      const [row] = await db
        .select({ id: dashboards.id, appId: dashboards.appId })
        .from(dashboards)
        .where(eq(dashboards.artifactId, artifactId))
        .limit(1);
      if (!row) return null;
      const grant = await appAccess(db, userId, row.appId);
      return grant ? { ...row, grant } : null;
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
