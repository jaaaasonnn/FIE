// An adapter that refuses every message, for rehearsing what happens when a
// provider is down: the retries, the give-up and the Sentry alert. It sends
// nothing and makes no network call. It is marked testOnly, so naming it in
// production does not select it: the channel is treated as off, with an alert.

import type { MessageProvider } from './types'

const make = (channel: 'EMAIL' | 'SMS'): MessageProvider => ({
  name: channel === 'EMAIL' ? 'fail-drill-email' : 'fail-drill-sms',
  channel,
  testOnly: true,
  send: async () => ({ ok: false, retryable: true, error: 'fail-drill adapter: every message is refused' }),
})

export const failDrillEmail = make('EMAIL')
export const failDrillSms = make('SMS')
