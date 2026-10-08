// The log-only adapter: accepts every message and sends nothing. It is what
// both channels use until a real provider is named, and it makes no network
// call of any kind. The message itself is already in the message log.

import type { MessageProvider } from './types'

const make = (channel: 'EMAIL' | 'SMS'): MessageProvider => ({
  name: 'log',
  channel,
  send: async () => ({ ok: true }),
})

export const logEmail = make('EMAIL')
export const logSms = make('SMS')
