import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl',
        hover && 'listing-card cursor-pointer',
        className
      )}
      style={{
        boxShadow: '0 4px 18px rgba(31, 27, 22, 0.06)',
        border: '1px solid rgba(232, 225, 214, 0.55)',
      }}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 pt-5 pb-3', className)}>{children}</div>
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-3', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('px-5 pb-5 pt-3', className)}
      style={{ borderTop: '1px solid rgba(232, 225, 214, 0.6)' }}
    >
      {children}
    </div>
  )
}

export function StatCard({
  icon, label, value, sub
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[#6B645C] mb-1">{label}</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {value}
          </p>
          {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-accent-subtle)' }}
        >
          {icon}
        </div>
      </div>
    </Card>
  )
}
