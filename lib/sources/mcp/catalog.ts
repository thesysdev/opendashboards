import { z } from "zod";

import { isHost } from "../host";
import type { SourceCatalog } from "../types";

/**
 * A remote MCP server: its Streamable HTTP endpoint, and which header carries
 * the API key. Safe for the browser: the key is the credential, never here.
 */

/** Headers the transport sets itself, or that would change where or how a request goes. */
const RESERVED_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "keep-alive",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "origin",
  "proxy-authorization",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
]);

/** The server's endpoint: HTTPS, a real host, no user info or fragment. Exported for tests. */
export function normalizeMcpUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  if (!isHost(url.hostname.replace(/^\[(.*)\]$/, "$1"))) return null;
  return url.href;
}

export const mcpConfigSchema = z
  .object({
    url: z.string().transform((value, ctx) => {
      const url = normalizeMcpUrl(value);
      if (!url) {
        ctx.addIssue({ code: "custom", message: "Enter the server's https:// endpoint, like https://mcp.example.com/mcp." });
        return z.NEVER;
      }
      return url;
    }),
    /** "Authorization" sends `Bearer <key>`; any other header sends the key as is. */
    headerName: z
      .string()
      .trim()
      .default("Authorization")
      .pipe(
        z
          .string()
          .regex(/^[A-Za-z0-9-]{1,64}$/, "Use a header name like Authorization or X-API-Key.")
          .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), "That header is set by OpenDashboards itself; choose another."),
      ),
  })
  .strict();

const httpsUrl = z
  .string()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Must be an https:// URL.");

/**
 * What OAuth needs later, set by OpenDashboards when the user signs in, never
 * typed: the server's authorization server and token endpoint (for refreshing),
 * and the resource the tokens are for. Nothing here is secret.
 */
export const mcpOAuthSettingsSchema = z
  .object({
    /** Where the authorization server was discovered, and the issuer it named (they must match). */
    issuer: httpsUrl,
    tokenEndpoint: httpsUrl,
    /** How the token endpoint wants the client to authenticate. */
    tokenAuthMethods: z.array(z.string().max(64)).max(10).optional(),
    revocationEndpoint: httpsUrl.optional(),
    /**
     * The resource the tokens are for (RFC 8707): the server's own identifier.
     * Also the key a shared dashboard would use to find a viewer's own sign-in.
     */
    resource: z.string().max(2_048),
    scope: z.string().max(2_000).optional(),
  })
  .strict();

/** Settings as stored: what was typed, plus the OAuth details for a server signed in to. */
export const mcpStoredConfigSchema = mcpConfigSchema.extend({ oauth: mcpOAuthSettingsSchema.optional() }).strict();

export type McpOAuthSettings = z.infer<typeof mcpOAuthSettingsSchema>;
export type McpConfig = z.infer<typeof mcpStoredConfigSchema>;

/** The key, or nothing for a public server. */
/** The size that matters is checked in bytes when it's stored (lib/secrets): this only stops absurd input. */
export const mcpKeySchema = z.string().trim().max(65_536, "That key is too long.");

export const mcpCatalog: SourceCatalog<McpConfig, "mcp"> = {
  // What a form may submit: never the OAuth details, which only a finished sign-in sets.
  type: "mcp",
  label: "MCP server",
  blurb: "Any remote MCP server, with an API key",
  tile: "MC",
  configSchema: mcpConfigSchema as unknown as z.ZodType<McpConfig>,
  describe: (config) => {
    const url = new URL(config.url);
    return { source: "MCP server", shortSource: "MCP", detail: `${url.host}${url.pathname === "/" ? "" : url.pathname}`, tile: "MC" };
  },
};
