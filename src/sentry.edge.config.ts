import * as Sentry from '@sentry/nextjs'
import { SCRUBBING } from '@/lib/sentryScrub'

// Loaded from src/instrumentation.ts for the edge runtime. No route in
// this app currently opts into `runtime: 'edge'`, but Next.js's
// middleware layer runs on edge regardless, so this stays initialized.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  // Emails, phone numbers, cookies and single-use links are taken out of
  // every report before it is sent (lib/sentryScrub.ts)
  ...SCRUBBING,
})
