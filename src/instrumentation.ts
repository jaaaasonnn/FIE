import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors thrown from route handlers and server components that
// Next.js catches internally — this is what gives the cron routes without
// their own try/catch (complete-bookings, update-exchange-rate) automatic
// error capture without needing to touch their code.
export const onRequestError = Sentry.captureRequestError
