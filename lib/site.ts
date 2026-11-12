/** Where OpenDashboards is served; absolute URLs in metadata, robots.txt and the sitemap start here. */
export const SITE_URL = "https://opendashboards.com";

/**
 * The gateway's sign-in page, on the same host; it isn't part of this app, so
 * it's reached with a plain link or form, never the router. `next` is where
 * the gateway sends people once they're in.
 */
export const SIGN_IN_PATH = "/auth/login";
export const SIGN_IN_NEXT = "/";
export const SIGN_IN_URL = `${SIGN_IN_PATH}?next=${encodeURIComponent(SIGN_IN_NEXT)}`;
