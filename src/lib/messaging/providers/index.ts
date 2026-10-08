// Every adapter the app knows, by the name used in EMAIL_PROVIDER and
// SMS_PROVIDER. "log" is the default for both and is handled before this is
// read, so it is not listed. A new provider is one line here.

import type { MessageProvider } from './types'
import { failDrillEmail, failDrillSms } from './failing'

export const PROVIDERS: Record<string, MessageProvider> = {
  [failDrillEmail.name]: failDrillEmail,
  [failDrillSms.name]: failDrillSms,
}

export type { MessageProvider, OutgoingMessage, SendResult } from './types'
