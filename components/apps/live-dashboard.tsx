"use client";

import { LiveArtifactRenderer } from "@openuidev/react-ui/cloud";
import { library } from "@prism/dashboard-kit";

import "@prism/dashboard-kit/styles.css";

import { useDashboardResponse } from "./app-workspace";

const interpreter = { url: "/api/interpreter" };

/**
 * A live dashboard from OpenUI Cloud, drawn with the dashboard kit. Its data
 * loads fresh through our interpreter every time it opens. When the Build
 * chat creates or edits it, the renderer gets Cloud's response too, and
 * follows the new version as it's built.
 */
export function LiveDashboard({ artifactId }: { artifactId: string }) {
  const response = useDashboardResponse(artifactId);
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto bg-white">
        <LiveArtifactRenderer
          id={artifactId}
          response={response}
          preview={false}
          library={library}
          interpreter={interpreter}
          onError={(errors) => {
            if (errors.length) console.error("[dashboard]", errors);
          }}
        />
    </div>
  );
}
