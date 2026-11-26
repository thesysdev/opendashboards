import posthog from "posthog-js";

// Thesys' PostHog project and proxy, shared with openui.com; lib/analytics.ts sends the server's events there.
// The key is set only on our production deployment, so copies of OpenDashboards send nothing.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: "https://dgoeivjus9jfp.cloudfront.net",
    capture_pageview: "history_change",
    disable_surveys: true,
  });
  posthog.register({ app: "opendashboards" });
}
