import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      // Single accent color for primary CTA
      primary:   'bg-[#C9932E] text-white hover:bg-[#B37F22] focus:ring-[#C9932E]/40',
      secondary: 'bg-[#F5ECD6] text-[#8A5E10] hover:bg-[#EDDFBF] focus:ring-[#C9932E]/30',
      outline:   'border-[1.5px] border-[#C9932E] text-[#C9932E] hover:bg-[#F5ECD6] focus:ring-[#C9932E]/30',
      ghost:     'text-[#6B645C] hover:bg-[#F4F2EE] focus:ring-[#E8E1D6]',
      danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    }

    const sizes = {
      sm: 'text-xs px-3.5 py-1.5',
      md: 'text-sm px-5 py-2.5',
      lg: 'text-base px-7 py-3.5',
    }

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
