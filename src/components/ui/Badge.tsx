import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'accent' | 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'gray'
  className?: string
}

export function Badge({ children, variant = 'accent', className }: BadgeProps) {
  const variants: Record<string, string> = {
    // Primary accent — warm gold, matches --color-accent
    accent: 'bg-[#F5ECD6] text-[#8A5E10] border border-[#E5D0A8]',
    // Legacy alias
    gold:   'bg-[#F5ECD6] text-[#8A5E10] border border-[#E5D0A8]',
    // Muted blue — desaturated so it doesn't compete with accent
    blue:   'bg-[#EBF0F7] text-[#3A5A8A] border border-[#C8D8ED]',
    // Muted greens / reds / etc
    green:  'bg-[#EAF5EE] text-[#2D6A42] border border-[#B8DEC5]',
    red:    'bg-[#FDECEA] text-[#8B2020] border border-[#F0C4C4]',
    purple: 'bg-[#F0ECFA] text-[#5B3FA0] border border-[#D3C5EE]',
    gray:   'bg-[#F4F2EE] text-[#6B645C] border border-[#E2DAD0]',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide',
        variants[variant] ?? variants.gray,
        className,
      )}
    >
      {children}
    </span>
  )
}

export function VerifiedBadge() {
  return (
    <Badge variant="blue">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      Verified
    </Badge>
  )
}

export function SuperhostBadge() {
  return (
    <Badge variant="accent">
      ⭐ Superhost
    </Badge>
  )
}
