import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/connections", permanent: false }];
  },
  logging: {
    // Dev logs every Server Function's arguments, and connection actions
    // receive API keys. Never print them.
    serverFunctions: false,
  },
  experimental: {
    agentFeedback: true,
  },
  // The dashboard kit is a workspace package consumed from source.
  transpilePackages: ["@prism/dashboard-kit"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Pinned to this folder, so a dependency installed from a path outside it
    // (scripts/openui-sync.mjs) can't widen what Turbopack resolves and watches.
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
