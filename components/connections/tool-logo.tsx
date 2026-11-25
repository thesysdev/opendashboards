import { sourceOfTool } from "@/lib/sources/tool-source";

import { SourceTile } from "./source-tile";

/**
 * The logo to show beside a tool call, by the tool's name: the logo of the source the
 * tool belongs to (PostHog for posthog_query), or null for a tool no known source owns,
 * which the caller marks with its own generic icon. Which tools have one is decided in
 * lib/sources/tool-source.ts; this only draws it, with the logo the app uses for each
 * source everywhere, at the size of the feed's icons.
 */
export function toolLogo(toolName: string): React.ReactNode | null {
  const source = sourceOfTool(toolName);
  if (!source) return null;
  return (
    <span title={source.label} data-call-logo={source.type} className="flex size-4">
      {/* Just the mark, at the size of the feed's other icons: no tile around it there. */}
      <SourceTile label={source.tile} className="size-4 rounded-none border-0 bg-transparent text-[8px] [&>svg]:size-full" />
    </span>
  );
}
