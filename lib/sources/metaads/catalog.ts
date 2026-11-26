import type { SourceCatalog } from "../types";
import { composioSignInConfigSchema, type ComposioSignInConfig } from "../composio/catalog";

/**
 * Meta Ads (Facebook and Instagram ads), read through Composio's Meta Ads
 * toolkit for now: people sign in with Facebook on Composio's approved app.
 * Client-safe.
 */
export const metaAdsConfigSchema = composioSignInConfigSchema;
export type MetaAdsConfig = ComposioSignInConfig;

export const metaAdsCatalog: SourceCatalog<MetaAdsConfig, "metaads"> = {
  type: "metaads",
  label: "Meta Ads",
  blurb: "Facebook and Instagram ads: spend, reach and results",
  tile: "MA",
  configSchema: metaAdsConfigSchema,
  describe: () => ({ source: "Meta Ads", shortSource: "Meta Ads", detail: "Signed in with Facebook", tile: "MA" }),
};
