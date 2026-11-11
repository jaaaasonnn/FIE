import * as Sentry from '@sentry/nextjs'

// A payment refused because there is no usable dollar-to-cedi rate (lib/exchangeRateShared.ts, rateInForce): no
// stored rate and INITIAL_USD_TO_GHS missing or not a number above zero. One Sentry alert per server process, with
// IDs only, so a misconfigured deploy is seen at once without one alert per guest.

let reported = false

export function reportNoRate(bookingId: string, instalmentId: string | null): void {
  if (reported) return
  reported = true
  console.error('[Payments] no usable exchange rate: payment refused', { bookingId, instalmentId })
  Sentry.captureMessage('No usable exchange rate: payments are refused until one is set', {
    level: 'error',
    tags: { area: 'payments', payment_issue: 'NO_EXCHANGE_RATE' },
    fingerprint: ['payment', 'NO_EXCHANGE_RATE'],
    contexts: { payment: { bookingId, instalmentId } },
  })
}
