import { db } from '@/lib/db'
import { EXCHANGE_RATE_BUFFER } from '@/lib/utils'

const API_BASE = 'https://v6.exchangerate-api.com/v6'
const AUTO_FETCH_STATUS_KEY = 'exchange_rate_auto_fetch_status'
export const AUTO_UPDATED_BY = 'auto:exchangerate-api'

export type AutoFetchStatus = {
  ok:    boolean
  at:    string   // ISO timestamp of this attempt
  rate?: number   // raw rate returned by the API, before buffer (only set when ok)
  error?: string  // only set when !ok
}

function getApiKey(): string {
  const key = process.env.EXCHANGE_RATE_API_KEY
  if (!key || key.startsWith('your_')) {
    throw new Error('EXCHANGE_RATE_API_KEY is not configured')
  }
  return key
}

async function fetchLiveRate(): Promise<{ ok: true; rate: number } | { ok: false; error: string }> {
  let apiKey: string
  try {
    apiKey = getApiKey()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Missing API key' }
  }

  try {
    const res = await fetch(`${API_BASE}/${apiKey}/pair/USD/GHS`, {
      // Cron runs are one-off server-to-server calls — no benefit to Next's
      // request cache here, and a cached miss would defeat the whole point.
      cache: 'no-store',
    })
    const data = await res.json()

    if (!res.ok || data.result !== 'success' || typeof data.conversion_rate !== 'number') {
      const reason = data?.['error-type'] ?? `HTTP ${res.status}`
      return { ok: false, error: `ExchangeRate-API error: ${reason}` }
    }

    return { ok: true, rate: data.conversion_rate }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error calling ExchangeRate-API' }
  }
}

async function recordAutoFetchStatus(status: AutoFetchStatus) {
  await db.siteSetting.upsert({
    where:  { key: AUTO_FETCH_STATUS_KEY },
    update: { value: JSON.stringify(status) },
    create: { key: AUTO_FETCH_STATUS_KEY, value: JSON.stringify(status) },
  })
}

export async function getAutoFetchStatus(): Promise<AutoFetchStatus | null> {
  const row = await db.siteSetting.findUnique({ where: { key: AUTO_FETCH_STATUS_KEY } })
  if (!row) return null
  try {
    return JSON.parse(row.value) as AutoFetchStatus
  } catch {
    return null
  }
}

export type UpdateExchangeRateResult =
  | { ok: true; rawRate: number; storedRate: number }
  | { ok: false; error: string }

/**
 * Fetches the live USD→GHS rate and, on success, stores it (with
 * EXCHANGE_RATE_BUFFER applied) as a new ExchangeRate row — the same table
 * an admin's manual override writes to, so GET /api/exchange-rate and every
 * page reading it via useExchangeRate() pick it up with no other change.
 *
 * On failure, deliberately does NOT touch the ExchangeRate table at all.
 * db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } }) — used by
 * every consumer, automated or manual — then simply keeps returning
 * whatever the last good row was (auto or manual), so a fetch failure can
 * never regress the app to some hardcoded default. The failure is instead
 * recorded in SiteSetting so it's visible (surfaced in the admin Settings
 * tab) instead of silently swallowed.
 */
export async function updateExchangeRateFromApi(): Promise<UpdateExchangeRateResult> {
  const result = await fetchLiveRate()
  const at = new Date().toISOString()

  if (!result.ok) {
    console.error('[ExchangeRateCron] fetch failed:', result.error)
    await recordAutoFetchStatus({ ok: false, at, error: result.error })
    return { ok: false, error: result.error }
  }

  const storedRate = result.rate * (1 + EXCHANGE_RATE_BUFFER)

  await db.exchangeRate.create({
    data: { usdToGhs: storedRate, updatedBy: AUTO_UPDATED_BY },
  })
  await recordAutoFetchStatus({ ok: true, at, rate: result.rate })

  return { ok: true, rawRate: result.rate, storedRate }
}
