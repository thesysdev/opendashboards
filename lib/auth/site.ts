export const DEFAULT_NEXT = "/apps";
export const SIGN_IN_PROVIDERS = [
  { id: "google", label: "Continue with Google" },
  { id: "github", label: "Continue with GitHub" },
] as const;

export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number]["id"];

export function isSignInProvider(value: string | null): value is SignInProvider {
  return SIGN_IN_PROVIDERS.some((provider) => provider.id === value);
}

/** Only paths on this site, so a crafted `next` can't send people elsewhere after sign-in. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  if (/[\\\u0000-\u001f]/.test(next) || next.startsWith("/auth")) return DEFAULT_NEXT;
  return next;
}

/** The origin in the browser's address bar, for redirects and OAuth callbacks. */
export function siteOrigin(headers: { get(name: string): string | null }): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const protocol = headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
