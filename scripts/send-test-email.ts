// Sends ONE real test email through the Resend adapter, to the address given.
// Run it by hand:
//
//     npm run email:test -- you@example.com --confirm
//
// It refuses without --confirm, a valid address and RESEND_API_KEY (read from
// the environment, or from .env if it is there). It writes nothing to the
// database and does not need MESSAGING_ENABLED or EMAIL_PROVIDER.

import { runTestSend } from '../src/lib/messaging/testSend'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env here: the key must already be in the environment
}

runTestSend(process.argv.slice(2)).then((code) => process.exit(code))
