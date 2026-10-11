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

const isProduction = process.env.NODE_ENV === "production"

/**
 * Where the browser sends reports of things the content policy would have
 * blocked: Sentry's own endpoint for them, built from the public DSN. Only in
 * production, so local work sends nothing anywhere.
 */
function cspReportUri(): string | null {
  if (!isProduction) return null
  try {
    const dsn = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN ?? "")
    const project = dsn.pathname.replace(/^\//, "")
    return dsn.username && project ? `https://${dsn.host}/api/${project}/security/?sentry_key=${dsn.username}` : null
  } catch {
    return null
  }
}

/**
 * The content policy: what a page may load and where it may send things.
 * Sent as Report-Only for now, so nothing is blocked while we watch what it
 * would have stopped. To enforce it, change the header's name below.
 */
function contentSecurityPolicy(): string {
  const storage = `https://${storageHost()}`
  const report = cspReportUri()
  return [
    "default-src 'self'",
    // Next puts small inline scripts in every page; the dev server also needs eval
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://images.unsplash.com ${storage} https://api.maptiler.com`,
    "font-src 'self' data:",
    // The map's tiles and style, and error reports
    "connect-src 'self' https://api.maptiler.com https://*.sentry.io",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(report ? [`report-uri ${report}`] : []),
  ].join("; ")
}

/** Sent with every page and every API response. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No other site may show FieGH inside a frame
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
]

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

  // Does not say what the site is built with
  poweredByHeader: false,
  // The browser is never given the source maps; Sentry gets its own copy at build time
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy() }],
      },
      // API answers are about one person, or change by the minute: never kept by a browser or a proxy
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ]
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

  // The maps are removed from the build once Sentry has them, so they are
  // never served to a browser
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Not using automaticVercelMonitors — it's deprecated and only ever
  // covered the Pages Router. All 3 cron routes are wrapped with
  // Sentry.withMonitor() directly instead (see src/app/api/cron/*).
});
