import type { SourceCatalog } from "../types";
import { composioSignInConfigSchema, type ComposioSignInConfig } from "../composio/catalog";

/**
 * Google Ads, read through Composio's Google Ads toolkit for now: people sign
 * in with Google on Composio's approved app. Client-safe.
 */
export const googleAdsConfigSchema = composioSignInConfigSchema;
export type GoogleAdsConfig = ComposioSignInConfig;

export const googleAdsCatalog: SourceCatalog<GoogleAdsConfig, "googleads"> = {
  type: "googleads",
  label: "Google Ads",
  blurb: "Campaigns, spend, clicks and conversions",
  tile: "GD",
  configSchema: googleAdsConfigSchema,
  describe: () => ({ source: "Google Ads", shortSource: "Google Ads", detail: "Signed in with Google", tile: "GD" }),
};
