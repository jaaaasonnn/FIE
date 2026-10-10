import Link from 'next/link'
import { Logo } from '@/components/ui/Wordmark'

/** The plain centred card the three account-link pages share. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="w-full max-w-md">
        <Link href="/" className="inline-block mb-6" aria-label="FieGH home"><Logo /></Link>
        <div className="soft-panel-lg p-6 sm:p-8">
          <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

export const authButton = 'w-full py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60'
export const authButtonStyle = { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }
