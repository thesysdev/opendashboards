import { z } from "zod";

import { bigqueryConfigSchema } from "@/lib/sources/bigquery/catalog";
import { CLICKHOUSE_DEFAULT_PORT, clickhouseConfigSchema, clickhousePasswordSchema } from "@/lib/sources/clickhouse/catalog";
import { ga4ConfigSchema } from "@/lib/sources/ga4/catalog";
import { googleAdsConfigSchema } from "@/lib/sources/googleads/catalog";
import { projectIdOfKey, serviceAccountKeySchema } from "@/lib/sources/google/credential";
import { mcpConfigSchema, mcpKeySchema } from "@/lib/sources/mcp/catalog";
import { metaAdsConfigSchema } from "@/lib/sources/metaads/catalog";
import type { McpAuth, McpService } from "@/lib/sources/mcp/services";
import { MYSQL_DEFAULT_PORT, mysqlConfigSchema, mysqlPasswordSchema, parseMysqlUrl } from "@/lib/sources/mysql/catalog";
import { searchConsoleConfigSchema } from "@/lib/sources/searchconsole/catalog";

/**
 * What the generic connection form asks for, per source. Client-safe. The
 * server validates everything again with the source's own schemas.
 */

export type FieldSpec = {
  name: string;
  label: string;
  kind: "text" | "password" | "number" | "textarea" | "ssl";
  placeholder?: string;
  description?: string;
  optional?: boolean;
  initial?: string;
  /** Half width, side by side with the next half-width field. */
  half?: boolean;
  /** Only used with an API key: hidden when signing in with OAuth. */
  keyOnly?: boolean;
  /** A file input that fills this field (e.g. a JSON key). */
  fileAccept?: string;
  /** A link after the description, e.g. where to create a key. */
  link?: { href: string; label: string };
};

export type FormSpec = {
  title: string;
  description: string;
  fields: FieldSpec[];
  /** The secret: a password or a key. The only field shown when replacing it. */
  credential: FieldSpec;
  replaceTitle: string;
  replaceAction: string;
  /** A connection URL people may paste instead of filling in the fields. */
  paste?: { label: string; placeholder: string; parse: (text: string) => Record<string, string | number> | null };
  /** Derives other fields when one changes, e.g. the project from a pasted key. */
  derive?: (name: string, value: string, values: Record<string, string>) => Record<string, string>;
  help?: { summary: string; intro: string; code?: string; steps?: string[] };
  /** What "plaintext" storage mode warns about. */
  secretNoun: string;
  /** MCP servers: signing in with OAuth and/or an API key. The switch (when both) goes after this field. */
  oauth?: { after: string; options: readonly McpAuth[]; server: string };
  /**
   * The source's own checks for its settings and its credential: the same ones the
   * server runs, so the form can show every problem before sending anything.
   */
  schemas: { config: z.ZodType; credential: z.ZodType };
};

/** A password a public, read-only server may not need. */
const NO_PASSWORD_OK: FieldSpec = {
  name: "password",
  label: "Password",
  kind: "password",
  optional: true,
  description: "Leave empty for a server that doesn't need one.",
};

/** A service account's JSON key: what every Google source takes. */
const SERVICE_ACCOUNT_KEY: FieldSpec = {
  name: "serviceAccountKey",
  label: "Service account key (JSON)",
  kind: "textarea",
  placeholder: '{ "type": "service_account", "client_email": "…", "private_key": "…" }',
  fileAccept: "application/json,.json",
  description: "Only the account's email and private key are kept, encrypted.",
};

const CREATE_SERVICE_ACCOUNT = [
  "In the Google Cloud console: IAM & Admin → Service accounts → Create service account, e.g. dashboards-reader. It needs no project roles.",
  "Open the account → Keys → Add key → Create new key → JSON.",
];

/**
 * A source that connects only by signing in through Composio: a name, then
 * the platform's own sign-in page. There's no key to paste.
 */
function composioSignInForm(input: { label: string; description: string; placeholder: string; server: string; config: z.ZodType }): FormSpec {
  return {
    title: `Connect ${input.label}`,
    description: input.description,
    fields: [{ name: "name", label: "Name", kind: "text", placeholder: input.placeholder, initial: input.label }],
    // Never shown or sent: signing in is the only way.
    credential: { name: "signIn", label: "Sign-in", kind: "password", optional: true },
    replaceTitle: "Sign in again",
    replaceAction: "Sign in",
    secretNoun: "sign-ins",
    oauth: { after: "name", options: ["oauth"], server: input.server },
    schemas: { config: input.config, credential: z.string() },
  };
}

export const SOURCE_FORMS: Record<"mysql" | "clickhouse" | "bigquery" | "ga4" | "searchconsole" | "googleads" | "metaads" | "mcp", FormSpec> = {
  mysql: {
    title: "Connect MySQL",
    description: "OpenDashboards runs read-only queries against your MySQL or MariaDB database to build dashboards.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Production MySQL" },
      { name: "host", label: "Host", kind: "text", placeholder: "db.example.com" },
      { name: "port", label: "Port", kind: "number", initial: String(MYSQL_DEFAULT_PORT), half: true },
      { name: "database", label: "Database", kind: "text", placeholder: "shop", half: true },
      { name: "user", label: "User", kind: "text", placeholder: "dashboards_reader" },
      { name: "sslMode", label: "SSL", kind: "ssl", initial: "verify-full" },
    ],
    credential: NO_PASSWORD_OK,
    replaceTitle: "Change password",
    replaceAction: "Test & change",
    paste: {
      label: "Connection string (optional)",
      placeholder: "mysql://user:password@host:3306/database",
      parse: (text) => parseMysqlUrl(text) as Record<string, string | number> | null,
    },
    help: {
      summary: "Use a read-only user (recommended)",
      intro: "OpenDashboards only reads, but a user that can't write is safer. Run this as an admin, then connect as dashboards_reader:",
      code: `CREATE USER 'dashboards_reader'@'%' IDENTIFIED BY '…' REQUIRE SSL;
GRANT SELECT, SHOW VIEW ON your_db.* TO 'dashboards_reader'@'%';`,
    },
    secretNoun: "passwords",
    schemas: { config: mysqlConfigSchema, credential: mysqlPasswordSchema },
  },
  clickhouse: {
    title: "Connect ClickHouse",
    description: "OpenDashboards runs read-only queries against ClickHouse over HTTPS to build dashboards.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Events warehouse" },
      { name: "host", label: "Host", kind: "text", placeholder: "abc123.us-east-1.aws.clickhouse.cloud" },
      {
        name: "port",
        label: "HTTPS port",
        kind: "number",
        initial: String(CLICKHOUSE_DEFAULT_PORT),
        half: true,
      },
      { name: "database", label: "Database", kind: "text", initial: "default", half: true },
      { name: "user", label: "User", kind: "text", placeholder: "dashboards_reader" },
      { name: "sslMode", label: "SSL", kind: "ssl", initial: "verify-full" },
    ],
    credential: NO_PASSWORD_OK,
    replaceTitle: "Change password",
    replaceAction: "Test & change",
    help: {
      summary: "Use a read-only user (recommended)",
      intro:
        "OpenDashboards runs every query read-only with its own time and row limits, but a user that can only SELECT is safer. Run this as an admin (no readonly profile setting: OpenDashboards sets it per query):",
      code: `CREATE USER dashboards_reader IDENTIFIED BY '…';
GRANT SELECT ON your_db.* TO dashboards_reader;`,
    },
    secretNoun: "passwords",
    schemas: { config: clickhouseConfigSchema, credential: clickhousePasswordSchema },
  },
  bigquery: {
    title: "Connect BigQuery",
    description: "OpenDashboards runs read-only queries in your Google Cloud project to build dashboards. Queries are billed to that project.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Analytics warehouse" },
      { name: "projectId", label: "Project ID", kind: "text", placeholder: "my-project-123", half: true, description: "Runs and pays for the queries." },
      { name: "location", label: "Location", kind: "text", placeholder: "US", optional: true, half: true, description: "Optional. US, EU, us-central1…" },
    ],
    credential: {
      name: "serviceAccountKey",
      label: "Service account key (JSON)",
      kind: "textarea",
      placeholder: '{ "type": "service_account", "client_email": "…", "private_key": "…" }',
      fileAccept: "application/json,.json",
      description: "Only the account's email and private key are kept, encrypted.",
    },
    replaceTitle: "Replace key",
    replaceAction: "Test & replace",
    derive: (name, value, values): Record<string, string> => {
      const projectId = name === "serviceAccountKey" && !values.projectId ? projectIdOfKey(value) : null;
      return projectId ? { projectId } : {};
    },
    help: {
      summary: "How to create a read-only service account",
      intro: "In the Google Cloud console:",
      steps: [
        "IAM & Admin → Service accounts → Create service account, e.g. dashboards-reader.",
        "Grant it BigQuery Job User (to run queries) and BigQuery Data Viewer (to read data), on the project or only on the datasets OpenDashboards should see.",
        "Open the account → Keys → Add key → Create new key → JSON, and paste or upload the file here.",
      ],
    },
    secretNoun: "keys",
    schemas: { config: bigqueryConfigSchema, credential: serviceAccountKeySchema },
  },
  ga4: {
    title: "Connect Google Analytics",
    description: "OpenDashboards reads reports from your GA4 property, read-only, to build dashboards.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Website analytics" },
      {
        name: "propertyId",
        label: "Property ID",
        kind: "text",
        placeholder: "123456789",
        description: "In GA4: Admin → Property settings. Numbers only, not the G- measurement ID.",
      },
    ],
    credential: SERVICE_ACCOUNT_KEY,
    replaceTitle: "Replace key",
    replaceAction: "Test & replace",
    help: {
      summary: "How to give OpenDashboards read-only access",
      intro: "A service account reads the property on OpenDashboards' behalf:",
      steps: [
        ...CREATE_SERVICE_ACCOUNT,
        "In the same Cloud project, enable the Google Analytics Data API (APIs & Services → Library).",
        "In GA4: Admin → Property access management → add the account's email as a Viewer.",
      ],
    },
    secretNoun: "keys",
    schemas: { config: ga4ConfigSchema, credential: serviceAccountKeySchema },
  },
  searchconsole: {
    title: "Connect Search Console",
    description: "OpenDashboards reads your site's Google Search performance, read-only, to build dashboards.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Google Search" },
      {
        name: "siteUrl",
        label: "Property",
        kind: "text",
        placeholder: "sc-domain:example.com",
        description: "As Search Console shows it: sc-domain:example.com for a Domain property, or https://www.example.com/ for a URL prefix.",
      },
    ],
    credential: SERVICE_ACCOUNT_KEY,
    replaceTitle: "Replace key",
    replaceAction: "Test & replace",
    help: {
      summary: "How to give OpenDashboards read-only access",
      intro: "A service account reads the property on OpenDashboards' behalf:",
      steps: [
        ...CREATE_SERVICE_ACCOUNT,
        "In the same Cloud project, enable the Google Search Console API (APIs & Services → Library).",
        "In Search Console: open the property → Settings → Users and permissions → Add user, with the account's email and Restricted permission.",
      ],
    },
    secretNoun: "keys",
    schemas: { config: searchConsoleConfigSchema, credential: serviceAccountKeySchema },
  },
  googleads: composioSignInForm({
    label: "Google Ads",
    description: "OpenDashboards reads your Google Ads campaigns and performance, read-only, to build dashboards. You sign in with Google.",
    placeholder: "Google Ads",
    server: "Google",
    config: googleAdsConfigSchema,
  }),
  metaads: composioSignInForm({
    label: "Meta Ads",
    description: "OpenDashboards reads your Facebook and Instagram ad performance, read-only, to build dashboards. You sign in with Facebook.",
    placeholder: "Meta Ads",
    server: "Facebook",
    config: metaAdsConfigSchema,
  }),
  mcp: {
    title: "Connect an MCP server",
    description: "OpenDashboards calls the server's tools to explore data and build dashboards. Only remote servers over HTTPS.",
    fields: [
      { name: "name", label: "Name", kind: "text", placeholder: "Billing MCP" },
      {
        name: "url",
        label: "Server URL",
        kind: "text",
        placeholder: "https://mcp.example.com/mcp",
        description: "The server's Streamable HTTP endpoint. Local (stdio) servers aren't supported.",
      },
      {
        name: "headerName",
        keyOnly: true,
        label: "Key header",
        kind: "text",
        initial: "Authorization",
        description: "Authorization sends the key as Bearer <key>. Use another header, like X-API-Key, if the server expects one.",
      },
    ],
    credential: {
      name: "apiKey",
      label: "API key",
      kind: "password",
      optional: true,
      description: "Leave empty for a public server. Prefer a key that can only read: dashboards call tools every time they open.",
    },
    replaceTitle: "Replace key",
    replaceAction: "Test & replace",
    secretNoun: "keys",
    oauth: { after: "url", options: ["oauth", "key"], server: "the server" },
    schemas: { config: mcpConfigSchema, credential: mcpKeySchema },
  },
};

/** The MCP form for a known server: just a name and how to authenticate. Its endpoint is fixed on the server. */
export function mcpPresetForm(preset: McpService): FormSpec {
  const base = SOURCE_FORMS.mcp;
  return {
    ...base,
    title: `Connect ${preset.label}`,
    description: `OpenDashboards calls ${preset.label}'s tools to explore your data and build dashboards. It only reads.`,
    fields: [{ name: "name", label: "Name", kind: "text", placeholder: preset.label, initial: preset.label }],
    credential: {
      name: "apiKey",
      label: preset.key?.label ?? "API key",
      kind: "password",
      placeholder: preset.key?.placeholder,
      description: preset.key?.hint,
      link: preset.key && { href: preset.key.href, label: "Create one" },
    },
    oauth: { after: "name", options: preset.auth, server: preset.label },
  };
}
