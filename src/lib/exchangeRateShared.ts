// The parts of lib/exchangeRate.ts that a page in the browser may read. Nothing here imports anything:
// exchangeRate.ts itself reaches the database, and a page that imported it would ship part of the database
// client to every visitor (lib/security/clientImports.test.ts).

/** Written as `updatedBy` when the rate came from the automatic fetch, not from an admin. */
export const AUTO_UPDATED_BY = 'auto:exchangerate-api'

export type AutoFetchStatus = {
  ok:    boolean
  at:    string   // ISO timestamp of this attempt
  rate?: number   // raw rate returned by the API, before buffer (only set when ok)
  error?: string  // only set when !ok
}
