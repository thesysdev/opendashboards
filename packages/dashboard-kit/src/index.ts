/**
 * @prism/dashboard-kit — an OpenUI Lang component library for analytics
 * dashboards.
 *
 *   import { library } from "@prism/dashboard-kit";
 *   import "@prism/dashboard-kit/styles.css";
 *
 *   <Renderer response={openuiLang} library={library} />
 *   const systemPrompt = library.prompt();
 */
export { componentGroups, components, library } from "./library";
export { DashboardHeading } from "./components/heading";
export { computeDelta, formatValue, FORMAT_PRESETS, type ValueFormat } from "./format";
export { SERIES_COLORS } from "./theme";
