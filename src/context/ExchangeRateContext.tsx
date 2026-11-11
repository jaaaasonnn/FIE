'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { GHS_RATE } from '@/lib/utils'
import { fetchRetry } from '@/lib/clientFetch'
import { usableRate } from '@/lib/exchangeRateShared'

type ExchangeRateContextType = {
  /** Null once the server has said there is no usable rate: pages then show dollars only, with no cedi line */
  rate:    number | null
  loading: boolean
}

// Starts at the same fallback the backend uses (GHS_RATE / INITIAL_USD_TO_GHS)
// so every consumer renders a real GH₵ figure immediately instead of $0 while
// the live DB-backed rate loads.
const ExchangeRateContext = createContext<ExchangeRateContextType>({ rate: GHS_RATE, loading: true })

export function ExchangeRateProvider({ children }: { children: ReactNode }) {
  const [rate,    setRate]    = useState<number | null>(GHS_RATE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRetry('/api/exchange-rate')
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      // An answer from the server decides; a failed request keeps the GHS_RATE fallback, as before
      .then(({ ok, data }) => { if (ok && data && 'rate' in data) setRate(usableRate(data.rate)) })
      .catch(() => { /* keep the GHS_RATE fallback */ })
      .finally(() => setLoading(false))
  }, [])

  return (
    <ExchangeRateContext.Provider value={{ rate, loading }}>
      {children}
    </ExchangeRateContext.Provider>
  )
}

export function useExchangeRate() {
  return useContext(ExchangeRateContext)
}
