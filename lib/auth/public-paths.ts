/**
 * The only paths served without signing in: the landing page and its images
 * in public/. Nothing under the app or the API is here. Anything added must
 * work without a user and read nothing that belongs to one.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", "/icon.svg", "/shiro-logo.svg"]);

/** Folders in public/ that hold only the landing page's images. No route lives under them. */
const PUBLIC_ASSET_FOLDERS = ["/brand-icons/", "/opendashboards/", "/shaders/"];

/** A plain file path: no dot segments, encoded characters or backslashes that could resolve somewhere else. */
const PLAIN_FILE = /^(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)+$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PLAIN_FILE.test(pathname) && PUBLIC_ASSET_FOLDERS.some((folder) => pathname.startsWith(folder));
}
