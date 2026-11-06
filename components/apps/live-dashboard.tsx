"use client";

import { LiveArtifactRenderer, OpenUICloudProvider } from "@openuidev/react-ui/cloud";
import { library } from "@prism/dashboard-kit";

import "@prism/dashboard-kit/styles.css";

const interpreter = { url: "/api/interpreter" };

/**
 * A live dashboard from OpenUI Cloud, drawn with the dashboard kit. Its data
 * loads fresh through our interpreter every time it opens.
 */
export function LiveDashboard({ artifactId }: { artifactId: string }) {
  return (
    <OpenUICloudProvider token="/api/frontend-token">
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        <LiveArtifactRenderer
          id={artifactId}
          preview={false}
          library={library}
          interpreter={interpreter}
          onError={(errors) => {
            if (errors.length) console.error("[dashboard]", errors);
          }}
        />
      </div>
    </OpenUICloudProvider>
  );
}
