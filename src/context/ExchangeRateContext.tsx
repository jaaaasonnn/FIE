'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { GHS_RATE } from '@/lib/utils'

type ExchangeRateContextType = {
  rate:    number
  loading: boolean
}

// Starts at the same fallback the backend uses (GHS_RATE / INITIAL_USD_TO_GHS)
// so every consumer renders a real GH₵ figure immediately instead of $0 while
// the live DB-backed rate loads.
const ExchangeRateContext = createContext<ExchangeRateContextType>({ rate: GHS_RATE, loading: true })

export function ExchangeRateProvider({ children }: { children: ReactNode }) {
  const [rate,    setRate]    = useState(GHS_RATE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/exchange-rate')
      .then((r) => r.json())
      .then((data) => { if (typeof data.rate === 'number' && data.rate > 0) setRate(data.rate) })
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
