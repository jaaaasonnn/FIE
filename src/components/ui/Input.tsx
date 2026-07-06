import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--brown-dark)' }}>
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              'w-full rounded-xl border bg-white px-4 py-3 text-sm transition-all',
              'focus:outline-none focus:ring-2',
              'placeholder:text-stone-400',
              leftIcon && 'pl-10',
              error
                ? 'border-red-300 focus:ring-red-200'
                : 'border-stone-200 focus:ring-amber-200 focus:border-amber-400',
              className
            )}
            style={{ }}
            {...props}
          />
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export function Select({ label, error, options, className, ...props }: SelectProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--brown-dark)' }}>
          {label}
        </label>
      )}
      <select
        className={cn(
          'w-full rounded-xl border bg-white px-4 py-3 text-sm transition-all appearance-none',
          'focus:outline-none focus:ring-2',
          error
            ? 'border-red-300 focus:ring-red-200'
            : 'border-stone-200 focus:ring-amber-200 focus:border-amber-400',
          className
        )}
        style={{ }}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function Textarea({
  label, error, className, ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--brown-dark)' }}>
          {label}
        </label>
      )}
      <textarea
        rows={4}
        className={cn(
          'w-full rounded-xl border bg-white px-4 py-3 text-sm transition-all resize-none',
          'focus:outline-none focus:ring-2',
          'placeholder:text-stone-400',
          error
            ? 'border-red-300 focus:ring-red-200'
            : 'border-stone-200 focus:ring-amber-200 focus:border-amber-400',
          className
        )}
        style={{ }}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
