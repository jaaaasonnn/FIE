import path from "path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * The host photos are served from: this project's Supabase storage, read from
 * SUPABASE_URL. Without it (it is always set where the app is built) no
 * Supabase host is allowed at all, rather than all of them.
 */
function storageHost(): string {
  try {
    return new URL(process.env.SUPABASE_URL ?? "").hostname
  } catch {
    console.warn("[next.config] SUPABASE_URL is not set: uploaded photos will not be optimised")
    return "storage.invalid"
  }
}

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

  // next/image resizes these and serves AVIF/WebP. Listing photos are either
  // seeded from Unsplash or uploaded to Supabase Storage's public buckets.
  images: {
    // WebP only. AVIF is left out on purpose: the image optimiser's AVIF path
    // has open advisories in this version of Next, and nothing here needs it.
    formats: ["image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Only this project's own storage, not every Supabase project's
      { protocol: "https", hostname: storageHost(), pathname: "/storage/v1/object/public/**" },
    ],
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
