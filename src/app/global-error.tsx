'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

// Only fires for errors that escape the root layout itself — this
// replaces the entire <html> document, so it can't rely on globals.css
// or any app component (they may be what's broken). Kept deliberately
// plain and dependency-free.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#FAF7F2', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1F1B16', marginBottom: '0.75rem' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#6B645C', marginBottom: '1.5rem' }}>
              We've been notified and are looking into it. Try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.75rem 1.75rem',
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: '0.875rem',
                backgroundColor: '#C9932E',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
