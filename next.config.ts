import path from "path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16. maplibre-gl is loaded client-side only
  // via dynamic({ ssr: false }) — no alias needed.
  //
  // root is pinned explicitly because a stray lockfile in a parent folder
  // was making Turbopack infer the wrong workspace root on some runs,
  // which changes its internal module hashes and corrupts the dev cache
  // ("Cannot find module '@swc/helpers-<hash>/...'").
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withSentryConfig(nextConfig, {
  org: "fie-gh",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Only makes noise in CI/deploy logs, not local dev.
  silent: !process.env.CI,

  // Source maps for app + framework code, so stack traces in Sentry
  // resolve to real file/line instead of minified bundle offsets.
  widenClientFileUpload: true,

  // Not using automaticVercelMonitors — it's deprecated and only ever
  // covered the Pages Router. All 3 cron routes are wrapped with
  // Sentry.withMonitor() directly instead (see src/app/api/cron/*).
});
