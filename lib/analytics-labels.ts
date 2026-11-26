/** Fixed labels shared by the server's and the browser's events, so both name things alike. */

/** A billing period, as events name it. */
export type IntervalLabel = "monthly" | "annual";

export const intervalLabel = (interval: "month" | "year"): IntervalLabel => (interval === "year" ? "annual" : "monthly");
