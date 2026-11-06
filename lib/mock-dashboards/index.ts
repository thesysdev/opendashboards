/**
 * Hand-written dashboards in OpenUI Lang, one per seeded dashboard, built
 * with @prism/dashboard-kit and static data. They stand in for generated
 * dashboards until the builder exists.
 *
 * Keyed by dashboard title (the titles in scripts/db-seed.mjs).
 */
import { experimentsOverview, mobileAppEngagement, stagingSmokeChecks } from "./engagement-experiments-errors";
import { growthMetrics, weeklyExecSummary } from "./growth-and-exec";
import { featureAdoptionSearch, marketingAttribution } from "./marketing-and-search";
import { onboardingHealth, retentionCohorts, signupFunnel } from "./funnels-and-retention";

export const MOCK_DASHBOARDS: Record<string, string> = {
  ...growthMetrics,
  ...weeklyExecSummary,
  ...signupFunnel,
  ...retentionCohorts,
  ...onboardingHealth,
  ...marketingAttribution,
  ...featureAdoptionSearch,
  ...mobileAppEngagement,
  ...experimentsOverview,
  ...stagingSmokeChecks,
};
