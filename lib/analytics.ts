/* PostHog, on the same project and proxy host as openui.com. See "Analytics" in AGENTS.md. */

type PostHog = (typeof import("posthog-js"))["default"];

let posthogPromise: Promise<PostHog> | undefined;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function loadPostHog(): Promise<PostHog> {
  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init("phc_3OLW53x09ZTVZSV6BEpj5uycj3ooqR6KOemOjx04e3D", {
      api_host: "https://dgoeivjus9jfp.cloudfront.net",
      capture_pageview: "history_change",
      session_recording: { sampleRate: 0.3, maskAllInputs: true },
      disable_surveys: true,
    });
    posthog.register({
      analytics_environment: window.location.hostname.endsWith(".vercel.app") ? "preview" : "production",
    });
    return posthog;
  });
  return posthogPromise;
}

/** Runs `use` with PostHog. Does nothing on localhost, and never throws into the caller. */
function withPostHog(use: (posthog: PostHog) => void): void {
  if (typeof window === "undefined" || isLocalHost(window.location.hostname)) return;
  void loadPostHog()
    .then(use)
    .catch(() => {});
}

export const analytics = {
  identify(user: { id: string; email: string }): void {
    withPostHog((posthog) => posthog.identify(user.id, { email: user.email }));
  },
  /** `event` without the prefix: `capture("app_created")` sends `opendashboards:app_created`. */
  capture(event: string, properties: Record<string, unknown> = {}): void {
    withPostHog((posthog) => posthog.capture(`opendashboards:${event}`, properties));
  },
};
