// What the tests use to steer the fake services and to read what they received.
const FAKE = 'http://127.0.0.1:4010/__control'

async function get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][])
  return (await fetch(`${FAKE}${path}?${q}`)).json() as Promise<T>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  return (await fetch(`${FAKE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<T>
}

export type FakeTx = { reference: string; amount: number; currency: string; email: string; status: string; metadata: Record<string, unknown>; callback_url: string; verified?: number; paidAmount?: number }
export type FakeTransfer = { reference: string; amount: number; recipient: string; reason: string; transfer_code: string; status: string; duplicateAttempts: number }
export type FakeRefund = { id: number; transaction_reference: string; amount: number; merchant_note: string; status: string }
export type FakeEmail = { id: string; to: string[]; subject: string; text?: string; html?: string; from?: string; key?: string }
export type Endpoint = 'initialize' | 'verify' | 'transfer' | 'transfer-lookup' | 'refund' | 'refund-list' | 'resolve' | 'recipient' | 'banks' | 'resend' | 'storage' | 'rate'
export type Behaviour = 'http500' | 'http400' | 'http429' | 'malformed' | 'empty' | 'reset' | 'hang' | 'swallow' | 'delay'

export const fakes = {
  /** Transactions the app started at the fake Paystack. `match` is any text in them, such as a booking id. */
  tx: (match?: string, reference?: string) => get<FakeTx[]>('/tx', { match, reference }),
  /** Settles a payment as Paystack would, without a browser; or changes what Paystack says was paid. */
  setTx: (reference: string, change: Partial<{ status: string; paidAmount: number; paidCurrency: string; webhook: 'none' | 'before' | 'after'; webhookDelayMs: number }>) => post<FakeTx>('/tx', { reference, ...change }),
  /** Sends a signed webhook to an app server. `forged` signs it wrongly. */
  webhook: (target: string, event: string, o: { reference?: string; data?: unknown; forged?: boolean; signature?: string; times?: number; extra?: unknown }) => post<{ statuses: number[] }>('/webhook', { target, event, ...o }),
  transfers: (match?: string) => get<FakeTransfer[]>('/transfers', { match }),
  refunds: (match?: string) => get<FakeRefund[]>('/refunds', { match }),
  setRefund: (id: number, status: string) => post('/refunds', { id, status }),
  recipients: (match?: string) => get<Record<string, unknown>[]>('/recipients', { match }),
  inbox: (to?: string, match?: string) => get<FakeEmail[]>('/inbox', { to, match }),
  sentry: (match?: string) => get<string[]>('/sentry', { match }),
  calls: (o: { endpoint?: Endpoint; service?: string; match?: string } = {}) => get<{ endpoint: string; text: string; at: number }[]>('/calls', o),
  files: (match?: string) => get<string[]>('/files', { match }),
  /** Makes one endpoint misbehave for requests containing `match`. Returns a function that removes the rule. */
  async rule(endpoint: Endpoint, behaviour: Behaviour, o: { match?: string; times?: number; delayMs?: number; message?: string } = {}): Promise<() => Promise<void>> {
    const rule = await post<{ id: string }>('/rule', { endpoint, behaviour, ...o })
    return async () => { await fetch(`${FAKE}/rule?id=${rule.id}`, { method: 'DELETE' }) }
  },
  rules: () => get<{ id: string; hits?: number; waiting?: number }[]>('/rules'),
}

/** Waits, by asking again, until `read` gives something. No fixed sleeps. */
export async function until<T>(read: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
