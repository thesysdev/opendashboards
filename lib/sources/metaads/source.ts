import "server-only";

import { z } from "zod";

import { config as appConfig } from "@/config";

import { ComposioError, isConfigured, isRecord, type ComposioDeps } from "../composio/client";
import { checkAccount, composioCredential, composioToError, flattenRows, readComposioCredential, releaseAccount, runAs } from "../composio/shared";
import type { ConnectionSource, SourceTool } from "../types";

import { metaAdsCatalog, type MetaAdsConfig } from "./catalog";

/**
 * Meta Ads through Composio. Read-only, enforced here: Composio's Meta Ads
 * toolkit can also create and change ads, so only the read tools below are
 * ever called (each tagged readOnlyHint by Composio).
 *
 * Facebook and Instagram are one source: Instagram ads run from the same ad
 * accounts, and the publisher_platform breakdown splits them.
 */

const TOOLS = {
  insights: "METAADS_GET_INSIGHTS",
  accounts: "METAADS_GET_AD_ACCOUNTS",
  campaigns: "METAADS_LIST_CAMPAIGNS",
} as const;

/** Meta's field and breakdown names: snake_case words. */
const name = z.string().regex(/^[a-z][a-z0-9_]{0,60}$/, "Use Meta's API name, e.g. spend, impressions, publisher_platform.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** Ids, names and dates stay text: numeric-looking ids would lose digits as numbers. */
const isMetric = (column: string) => !/(^|[._])(id|name|date_start|date_stop|currency)$|_id$|_name$|^date/.test(column);

/** One page of insights at most this big; more pages follow until the row limit. */
const PAGE = 500;
const MAX_PAGES = 25;

type InsightsArgs = {
  objectId: string;
  level: "account" | "campaign" | "adset" | "ad";
  fields: string[];
  breakdowns?: string[];
  since?: string;
  until?: string;
  datePreset?: "today" | "yesterday" | "last_7d" | "last_30d" | "this_month" | "last_month" | "this_quarter";
  timeIncrement?: number | "monthly" | "all_days";
  sort?: string[];
};

const insightsTool: SourceTool<MetaAdsConfig, InsightsArgs> = {
  name: "metaads_insights",
  description:
    "Facebook and Instagram ad performance (Meta's Insights API), aggregated by Meta. objectId is an ad account (act_…, from metaads_accounts), a campaign, ad set or ad id; " +
    "level is the row grain (account, campaign, adset, ad) and must be at or below the object. " +
    "fields: spend, impressions, reach, frequency, clicks, ctr, cpc, cpm, actions, action_values, purchase_roas, campaign_name, adset_name, ad_name… " +
    "breakdowns split rows: publisher_platform (facebook vs instagram), platform_position, age, gender, country, impression_device. " +
    "Dates: since and until (YYYY-MM-DD, within the last 37 months), or datePreset; timeIncrement 1 for daily rows, 7 for weekly, monthly, or all_days. " +
    "actions and action_values come back as one column per action type, e.g. actions.purchase, action_values.purchase. Spend is in the ad account's currency. " +
    "Missing values aren't zeros. Returns { columns, rows, truncated }.",
  parameters: z
    .object({
      objectId: z.string().regex(/^(act_)?\d{5,25}$/, "An ad account id (act_123…) or a campaign, ad set or ad id."),
      level: z.enum(["account", "campaign", "adset", "ad"]),
      fields: z.array(name).min(1).max(40),
      breakdowns: z.array(name).max(4).optional(),
      since: day.optional(),
      until: day.optional(),
      datePreset: z.enum(["today", "yesterday", "last_7d", "last_30d", "this_month", "last_month", "this_quarter"]).optional(),
      timeIncrement: z.union([z.number().int().min(1).max(90), z.enum(["monthly", "all_days"])]).optional(),
      sort: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,60}_(ascending|descending)$/)).max(3).optional(),
    }),
  output: {
    columns: ["date_start", "date_stop", "campaign_name", "publisher_platform", "spend", "impressions", "clicks", "actions.purchase"],
    rows: [
      { date_start: "2026-11-01", date_stop: "2026-11-01", campaign_name: "Winter sale", publisher_platform: "instagram", spend: 1520.4, impressions: 48210, clicks: 912, "actions.purchase": 31 },
    ],
    truncated: false,
  },
  callers: ["agent", "dashboard"],
  async execute(connection, args, { signal, caller }) {
    const maxRows = appConfig().composio.maxRows[caller];
    // Checked here, not in the schema: the tool runner rebuilds the schema from its fields.
    if (!!args.since !== !!args.until) throw new ComposioError("bad_request", "give both since and until, or neither", "metaads");
    if (args.since && args.datePreset) throw new ComposioError("bad_request", "use since/until or datePreset, not both", "metaads");
    const request: Record<string, unknown> = {
      object_id: args.objectId,
      level: args.level,
      fields: args.fields,
      ...(args.breakdowns?.length && { breakdowns: args.breakdowns }),
      ...(args.since && args.until ? { time_range: { since: args.since, until: args.until } } : {}),
      ...(args.datePreset && { date_preset: args.datePreset }),
      ...(args.timeIncrement !== undefined && { time_increment: args.timeIncrement }),
      ...(args.sort?.length && { sort: args.sort }),
    };
    const rows: unknown[] = [];
    let after: string | undefined;
    let more = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await runAs(
        "metaads",
        connection,
        TOOLS.insights,
        { ...request, limit: Math.min(PAGE, maxRows + 1 - rows.length), ...(after && { after }) },
        signal,
      );
      if (isRecord(data) && Array.isArray(data.data)) rows.push(...data.data);
      const paging = isRecord(data) && isRecord(data.paging) ? data.paging : null;
      const next = paging && isRecord(paging.cursors) && typeof paging.cursors.after === "string" ? paging.cursors.after : undefined;
      more = Boolean(paging?.next) && !!next;
      if (!more || rows.length > maxRows) break;
      after = next;
    }
    const result = flattenRows(rows, isMetric, maxRows);
    return { ...result, truncated: result.truncated || more };
  },
};

const accountsTool: SourceTool<MetaAdsConfig, Record<string, never>> = {
  name: "metaads_accounts",
  description: "The Meta ad accounts this sign-in can read: id (act_…, for metaads_insights), name, currency, time zone, status and business.",
  parameters: z.object({}),
  output: {
    columns: ["id", "account_id", "name", "currency", "timezone_name", "account_status", "business_name"],
    rows: [{ id: "act_1234567890", account_id: "1234567890", name: "Acme D2C", currency: "INR", timezone_name: "Asia/Kolkata", account_status: 1, business_name: "Acme" }],
    truncated: false,
  },
  callers: ["agent"],
  async execute(connection, _args, { signal }) {
    const data = await runAs(
      "metaads",
      connection,
      TOOLS.accounts,
      { fields: "id,account_id,name,currency,timezone_name,account_status,business_name", limit: 200 },
      signal,
    );
    const rows = isRecord(data) && Array.isArray(data.data) ? data.data : [];
    return flattenRows(rows, (column) => column === "account_status", 200);
  },
};

const campaignsTool: SourceTool<MetaAdsConfig, { adAccountId: string; includeArchived?: boolean }> = {
  name: "metaads_campaigns",
  description: "The campaigns in one Meta ad account: id, name, objective, status and budgets (in the account currency's minor unit, e.g. paise or cents).",
  parameters: z.object({
    adAccountId: z.string().regex(/^(act_)?\d{5,25}$/, "An ad account id from metaads_accounts."),
    includeArchived: z.boolean().optional(),
  }),
  output: {
    columns: ["id", "name", "objective", "status", "effective_status", "daily_budget"],
    rows: [{ id: "120210000000000001", name: "Winter sale", objective: "OUTCOME_SALES", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "500000" }],
    truncated: false,
  },
  callers: ["agent"],
  async execute(connection, { adAccountId, includeArchived }, { signal }) {
    const data = await runAs(
      "metaads",
      connection,
      TOOLS.campaigns,
      {
        ad_account_id: adAccountId,
        fields: ["id", "name", "objective", "status", "effective_status", "daily_budget", "lifetime_budget", "start_time", "stop_time"],
        limit: 200,
        ...(includeArchived ? {} : { effective_status: ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES"] }),
      },
      signal,
    );
    const rows = isRecord(data) && Array.isArray(data.data) ? data.data : [];
    return { ...flattenRows(rows, () => false, 200), truncated: Boolean(isRecord(data) && isRecord(data.paging) && data.paging.next) };
  },
};

/** Tests only: where account checks go. */
export const metaAdsDeps: { composio?: ComposioDeps } = {};

export const metaAdsSource: ConnectionSource<MetaAdsConfig> = {
  ...metaAdsCatalog,
  credential: composioCredential(metaAdsCatalog.label, "composio-metaads"),
  async test(_config, credential, signal) {
    await checkAccount("metaads", readComposioCredential(credential), metaAdsDeps.composio, signal);
    return [];
  },
  available: () => isConfigured(metaAdsCatalog.type),
  release: (credential) => releaseAccount(credential, metaAdsDeps.composio),
  toError: (error) => composioToError(metaAdsCatalog, error),
  tools: [insightsTool, accountsTool, campaignsTool],
};
