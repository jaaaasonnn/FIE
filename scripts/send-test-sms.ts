// Sends ONE test SMS through the Arkesel adapter, to the Ghana mobile number
// given. Run it by hand:
//
//     npm run sms:test -- 0XXXXXXXXX --confirm --sandbox   (Arkesel's sandbox: not delivered, not charged)
//     npm run sms:test -- 0XXXXXXXXX --confirm             (a real, charged SMS)
//
// It refuses without --confirm, a valid Ghana mobile number and
// ARKESEL_API_KEY (read from the environment, or from .env if it is there).
// It writes nothing to the database and does not need MESSAGING_ENABLED or
// SMS_PROVIDER.

import { runTestSms } from '../src/lib/messaging/testSms'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env here: the key must already be in the environment
}

runTestSms(process.argv.slice(2)).then((code) => process.exit(code))
