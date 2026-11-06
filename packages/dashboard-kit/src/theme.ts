/**
 * Chart colours. Charts read these CSS variables (defined in styles.css), so a
 * host can re-theme by overriding `--pdk-series-*` and friends on `.pdk-root`.
 *
 * The categorical order was validated for colour-vision deficiency: adjacent
 * slots stay distinguishable (CVD ΔE ≥ 12 light), and the first three stay
 * distinguishable in every pairing, which is why part-to-whole charts show at
 * most three slices plus "Other". Assign in order; never by rank. The dark
 * theme (styles.css) has its own steps, validated on the dark card surface.
 */
export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--pdk-series-${i + 1})`);

/** The de-emphasis colour for the previous period, targets and "other". */
export const MUTED_COLOR = "var(--pdk-muted-mark)";

/** Slots 1–8 in order; anything past the eighth is grey "other", never a generated or repeated hue. */
export const seriesColor = (index: number) => (index < SERIES_COLORS.length ? SERIES_COLORS[index] : MUTED_COLOR);

/** The single-hue ramp for magnitude (heatmaps, cohort grids), light → dark. */
export const SEQUENTIAL = Array.from({ length: 9 }, (_, i) => `var(--pdk-seq-${i + 1})`);

/** Picks a ramp step for a value in [min, max]. */
export function sequentialColor(value: number, min: number, max: number): { background: string; ink: "light" | "dark" } {
  // When every value is equal there is no magnitude to show: use a mid step, not the darkest.
  const t = max === min ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const step = Math.round(t * (SEQUENTIAL.length - 1));
  return { background: SEQUENTIAL[step], ink: step >= 5 ? "light" : "dark" };
}
