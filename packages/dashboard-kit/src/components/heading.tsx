import type { ReactNode } from "react";

/**
 * A dashboard's title and description, drawn by the host above the rendered
 * program. They aren't part of the program: the host keeps them (and lets
 * people rename them), so the model never writes them. Same look, spacing
 * and width as the dashboard below it.
 */
export function DashboardHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="pdk-root pdk-container">
      <div className="pdk-dashboard pdk-dashboard-heading">
        <header className="pdk-header">
          <div>
            <h1 className="pdk-header-title">{title}</h1>
            {description ? <p className="pdk-header-description">{description}</p> : null}
          </div>
        </header>
      </div>
    </div>
  );
}
