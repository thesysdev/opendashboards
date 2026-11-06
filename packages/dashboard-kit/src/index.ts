/**
 * @prism/dashboard-kit — an OpenUI Lang component library for analytics
 * dashboards.
 *
 *   import { library, promptOptions } from "@prism/dashboard-kit";
 *   import "@prism/dashboard-kit/styles.css";
 *
 *   <Renderer response={openuiLang} library={library} />
 *   const systemPrompt = library.prompt(promptOptions);
 */
export { componentGroups, components, library, promptOptions } from "./library";
export { computeDelta, formatValue, FORMAT_PRESETS, type ValueFormat } from "./format";
export { SERIES_COLORS } from "./theme";
