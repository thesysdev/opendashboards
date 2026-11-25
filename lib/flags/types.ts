import type { Scope } from "@/lib/orgs/access";

/** The feature flags OpenDashboards checks, by their key in the flag provider. */
export const FLAGS = {
  /** Google Ads and Meta Ads sources, while they roll out. */
  adsSources: "opendashboards-ads-sources",
} as const;

export type Flag = (typeof FLAGS)[keyof typeof FLAGS];

export type FlagProviderName = "posthog" | "static";

export interface FlagProvider {
  readonly provider: FlagProviderName;
  /** Whether the flag is on for this person in this workspace. Never throws: a flag it can't answer for is off. */
  isEnabled(flag: Flag, scope: Scope): Promise<boolean>;
}
