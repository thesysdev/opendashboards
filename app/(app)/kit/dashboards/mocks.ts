import type { KitProgram } from "@/app/(app)/kit/program";

import { experimentsOverview, mobileAppEngagement, stagingSmokeChecks } from "./programs/engagement-experiments-errors";
import { onboardingHealth, retentionCohorts, signupFunnel } from "./programs/funnels-and-retention";
import { growthMetrics, weeklyExecSummary } from "./programs/growth-and-exec";
import { featureAdoptionSearch, marketingAttribution } from "./programs/marketing-and-search";

/**
 * Hand-written dashboards with realistic static data, showing how real
 * dashboards built with @opendashboards/dashboard-kit look. Development only (/kit).
 */
const APPS: { app: string; dashboards: Record<string, KitProgram> }[] = [
  { app: "Growth metrics", dashboards: growthMetrics },
  { app: "Weekly exec summary", dashboards: weeklyExecSummary },
  { app: "Signup funnel", dashboards: signupFunnel },
  { app: "Retention cohorts", dashboards: retentionCohorts },
  { app: "Onboarding health", dashboards: onboardingHealth },
  { app: "Marketing attribution", dashboards: marketingAttribution },
  { app: "Feature adoption: Search", dashboards: featureAdoptionSearch },
  { app: "Mobile app engagement", dashboards: mobileAppEngagement },
  { app: "Experiments overview", dashboards: experimentsOverview },
  { app: "Staging smoke checks", dashboards: stagingSmokeChecks },
];

export type MockDashboard = { slug: string; app: string; title: string; program: KitProgram };

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const MOCK_DASHBOARDS: MockDashboard[] = APPS.flatMap(({ app, dashboards }) =>
  Object.entries(dashboards).map(([title, program]) => ({ slug: `${slugify(app)}--${slugify(title)}`, app, title, program })),
);

export const MOCK_APPS = APPS.map(({ app }) => ({
  app,
  dashboards: MOCK_DASHBOARDS.filter((dashboard) => dashboard.app === app),
}));
