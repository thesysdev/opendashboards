"use client";

import { LiveArtifactRenderer } from "@openuidev/react-ui/cloud";
import { library } from "@prism/dashboard-kit";

import "@prism/dashboard-kit/styles.css";

import { useDashboardResponse } from "./app-workspace";
import { DashboardTitle } from "./dashboard-title";

const interpreter = { url: "/api/interpreter" };

/**
 * A live dashboard from OpenUI Cloud, drawn with the dashboard kit, under
 * its title and description (Prism's own, not part of the program). Its data
 * loads fresh through our interpreter every time it opens. When the Build
 * chat creates or edits it, the renderer gets Cloud's response too, and
 * follows the new version as it's built.
 */
export function LiveDashboard({
  appId,
  dashboard,
}: {
  appId: string;
  dashboard: { id: string; artifactId: string; title: string; description: string | null };
}) {
  const response = useDashboardResponse(dashboard.artifactId);
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto bg-white">
        <DashboardTitle appId={appId} dashboard={dashboard} />
        <LiveArtifactRenderer
          id={dashboard.artifactId}
          response={response}
          preview={false}
          library={library}
          interpreter={interpreter}
          onError={(errors) => {
            if (errors.length) console.error("[dashboard]", JSON.stringify(errors));
          }}
        />
    </div>
  );
}
