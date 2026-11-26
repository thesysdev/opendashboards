/**
 * Paths served without signing in include the landing and pricing pages,
 * landing page images, crawler and link preview assets, the MCP client
 * metadata document, and Stripe's webhook. Anything added must work
 * without a signed-in user.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/pricing",
  "/icon.svg",
  "/shiro-logo.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/oauth/client-metadata.json",
  // Stripe calls it without a session; it checks Stripe's signature itself.
  "/api/stripe/webhook",
]);

/** The folder in public/ that holds only the landing page's images. No route lives under it. */
const PUBLIC_ASSET_FOLDER = "/landing/";

/** A plain file path: no dot segments, encoded characters or backslashes that could resolve somewhere else. */
const PLAIN_FILE = /^(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)+$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PLAIN_FILE.test(pathname) && pathname.startsWith(PUBLIC_ASSET_FOLDER);
}
