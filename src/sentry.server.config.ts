import * as Sentry from '@sentry/nextjs'

// Loaded from src/instrumentation.ts for the Node.js runtime. Handles
// server components, route handlers, and the 3 cron routes.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Error capture only for now — performance tracing is a later-stage
  // concern, not needed to get basic "something broke" visibility.
  tracesSampleRate: 0,
})
