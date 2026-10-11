import * as Sentry from '@sentry/nextjs'
import { SCRUBBING } from '@/lib/sentryScrub'

// Loaded automatically by Next.js on the client — no import needed
// elsewhere. Covers real users hitting broken UI, not just API/cron
// failures. No session replay or feedback widget yet — minimal error
// capture only, per the scoped plan.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  // Emails, phone numbers, cookies and single-use links are taken out of
  // every report before it is sent (lib/sentryScrub.ts)
  ...SCRUBBING,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
