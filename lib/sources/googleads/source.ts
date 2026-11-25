import "server-only";

import { z } from "zod";

import { config as appConfig } from "@/config";

import { isConfigured, isRecord, type ComposioDeps } from "../composio/client";
import { checkAccount, composioCredential, composioToError, flattenRows, readComposioCredential, releaseAccount, releasePendingAccount, runAs } from "../composio/shared";
import type { ConnectionSource, OpenConnection, QueryResult, SourceTool } from "../types";

import { googleAdsCatalog, type GoogleAdsConfig } from "./catalog";

/**
 * Google Ads through Composio. Read-only, enforced here: the Google Ads
 * OAuth scope can also change campaigns, and Composio's toolkit has tools
 * that do, so only the read tools below are ever called (each tagged
 * readOnlyHint by Composio), and a query must be a GAQL SELECT, which can't
 * change anything.
 */

const TOOLS = {
  query: "GOOGLEADS_SEARCH_STREAM_GAQL",
  accounts: "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS",
  fields: "GOOGLEADS_SEARCH_GOOGLE_ADS_FIELDS",
} as const;

/** Customer ids as Google Ads shows them (123-456-7890) or plain digits. */
const customerId = z
  .string()
  .trim()
  .transform((value) => value.replace(/[-\s]/g, ""))
  .pipe(z.string().regex(/^\d{6,12}$/, "Use the 10-digit customer id, e.g. 123-456-7890, from googleads_accounts."));

/** One GAQL SELECT, nothing after it. */
export const gaqlSchema = z
  .string()
  .trim()
  .min(1)
  .max(10_000)
  .refine((query) => /^select\s/i.test(query), "Only GAQL SELECT queries can run.")
  .refine((query) => !query.includes(";"), "Send one GAQL query, without semicolons.");

/**
 * A LIMIT one past what's kept, so a cut-off result says so. The query's own
 * LIMIT stays when it's smaller; a larger one is lowered.
 */
export function withLimit(query: string, maxRows: number): string {
  const own = /\blimit\s+(\d+)\s*$/i.exec(query);
  if (!own) return `${query} LIMIT ${maxRows + 1}`;
  return Number(own[1]) <= maxRows + 1 ? query : `${query.slice(0, own.index)}LIMIT ${maxRows + 1}`;
}

const isMetric = (column: string) => column.startsWith("metrics.");

async function gaql(connection: OpenConnection<GoogleAdsConfig>, customer: string, query: string, maxRows: number, signal: AbortSignal): Promise<QueryResult> {
  const data = await runAs("googleads", connection, TOOLS.query, { customer_id: customer, query: withLimit(query, maxRows) }, signal);
  const results = isRecord(data) && Array.isArray(data.results) ? data.results : [];
  return flattenRows(results, isMetric, maxRows);
}

const queryTool: SourceTool<GoogleAdsConfig, { customerId: string; query: string }> = {
  name: "googleads_query",
  description:
    "Run a read-only Google Ads Query Language (GAQL) SELECT on one Google Ads account (customerId from googleads_accounts). " +
    "Google aggregates on its side: select segments to group by, e.g. " +
    "SELECT campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
    "FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC. " +
    "Columns come back flattened in Google's JSON names (campaign.name, segments.date, metrics.costMicros); costs are in micros: divide by 1,000,000 for the account's currency. " +
    "Every metrics query needs a date filter (segments.date DURING … or BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'). " +
    "Use googleads_fields when unsure a field exists or can be selected with a resource. " +
    "Returns { columns, rows, truncated }.",
  parameters: z.object({
    customerId: customerId.describe("The Google Ads customer id to query, from googleads_accounts."),
    query: gaqlSchema.describe("One GAQL SELECT … FROM … statement."),
  }),
  output: {
    columns: ["campaign.name", "segments.date", "metrics.impressions", "metrics.clicks", "metrics.costMicros"],
    rows: [{ "campaign.name": "Brand search", "segments.date": "2026-11-01", "metrics.impressions": 18234, "metrics.clicks": 1210, "metrics.costMicros": 845000000 }],
    truncated: false,
  },
  callers: ["agent", "dashboard"],
  execute: (connection, { customerId: customer, query }, { signal, caller }) =>
    gaql(connection, customer, query, appConfig().composio.maxRows[caller], signal),
};

const accountsTool: SourceTool<GoogleAdsConfig, Record<string, never>> = {
  name: "googleads_accounts",
  description:
    "The Google Ads accounts this sign-in can read: customer id, name, currency, time zone and whether it's a manager (MCC) account. " +
    "Query a client account, not a manager account: managers have no campaigns of their own.",
  parameters: z.object({}),
  output: {
    columns: ["customerId", "name", "currency", "timeZone", "manager"],
    rows: [{ customerId: "1234567890", name: "Acme Store", currency: "INR", timeZone: "Asia/Kolkata", manager: false }],
    truncated: false,
  },
  callers: ["agent"],
  async execute(connection, _args, { signal }) {
    const data = await runAs("googleads", connection, TOOLS.accounts, {}, signal);
    const names = isRecord(data) && Array.isArray(data.resourceNames) ? data.resourceNames : [];
    const ids = names.map((name) => String(name).replace(/^customers\//, "")).filter((id) => /^\d+$/.test(id));
    // Names for the first few: one query each, so a person with many accounts doesn't spend the quota here.
    const described = await Promise.all(
      ids.slice(0, 20).map(async (id) => {
        try {
          const result = await gaql(
            connection,
            id,
            "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer",
            1,
            signal,
          );
          const row = result.rows[0] ?? {};
          return { customerId: id, name: row["customer.descriptiveName"] ?? null, currency: row["customer.currencyCode"] ?? null, timeZone: row["customer.timeZone"] ?? null, manager: row["customer.manager"] ?? null };
        } catch {
          // Not readable on its own (a client reached only through its manager, say): still listed.
          return { customerId: id, name: null, currency: null, timeZone: null, manager: null };
        }
      }),
    );
    const rows = [...described, ...ids.slice(20).map((id) => ({ customerId: id, name: null, currency: null, timeZone: null, manager: null }))];
    return { columns: ["customerId", "name", "currency", "timeZone", "manager"], rows, truncated: false };
  },
};

const fieldsTool: SourceTool<GoogleAdsConfig, { prefix: string }> = {
  name: "googleads_fields",
  description:
    "Google Ads fields whose names start with a prefix (a resource like campaign or ad_group, or metrics, segments): name, category, type, and whether each can be selected, filtered and sorted.",
  parameters: z.object({
    prefix: z
      .string()
      .regex(/^[a-z][a-z0-9_.]{0,80}$/, "A field name prefix, e.g. campaign, metrics.cost, segments.")
      .describe("e.g. campaign, ad_group_ad.ad, metrics, segments.date"),
  }),
  output: {
    columns: ["name", "category", "dataType", "selectable", "filterable", "sortable"],
    rows: [{ name: "metrics.cost_micros", category: "METRIC", dataType: "INT64", selectable: true, filterable: true, sortable: true }],
    truncated: false,
  },
  callers: ["agent"],
  async execute(connection, { prefix }, { signal }) {
    const data = await runAs(
      "googleads",
      connection,
      TOOLS.fields,
      { query: `SELECT name, category, data_type, selectable, filterable, sortable WHERE name LIKE '${prefix}%'`, page_size: 200 },
      signal,
    );
    const results = isRecord(data) && Array.isArray(data.results) ? data.results : [];
    const rows = results.filter(isRecord).map((field) => ({
      name: field.name ?? null,
      category: field.category ?? null,
      dataType: field.dataType ?? field.data_type ?? null,
      selectable: field.selectable ?? null,
      filterable: field.filterable ?? null,
      sortable: field.sortable ?? null,
    }));
    return { columns: ["name", "category", "dataType", "selectable", "filterable", "sortable"], rows, truncated: Boolean(isRecord(data) && (data.next_page_token ?? data.nextPageToken)) };
  },
};

/** Tests only: where account checks go. */
export const googleAdsDeps: { composio?: ComposioDeps } = {};

export const googleAdsSource: ConnectionSource<GoogleAdsConfig> = {
  ...googleAdsCatalog,
  credential: composioCredential(googleAdsCatalog.label, "composio-googleads"),
  async test(_config, credential, signal) {
    await checkAccount("googleads", readComposioCredential(credential), googleAdsDeps.composio, signal);
    return [];
  },
  available: () => isConfigured(googleAdsCatalog.type),
  release: (credential) => releaseAccount(credential, googleAdsDeps.composio),
  releasePending: (pending) => releasePendingAccount(pending, googleAdsDeps.composio),
  toError: (error) => composioToError(googleAdsCatalog, error),
  tools: [queryTool, accountsTool, fieldsTool],
};
