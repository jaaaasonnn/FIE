import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, ...props }, ref) => {
    // The label is tied to its field, so a screen reader says what the field is for and a click on the label lands in it
    const generated = useId()
    const id = props.id ?? generated
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
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
                : 'border-stone-200 focus:ring-[#C9932E]/40 focus:border-amber-400',
              className
            )}
            style={{ }}
            {...props}
            id={id}
          />
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-[#6B645C]">{hint}</p>}
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
  const generated = useId()
  const id = props.id ?? generated
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
          {label}
        </label>
      )}
      <select
        className={cn(
          'w-full rounded-xl border bg-white px-4 py-3 text-sm transition-all appearance-none',
          'focus:outline-none focus:ring-2',
          error
            ? 'border-red-300 focus:ring-red-200'
            : 'border-stone-200 focus:ring-[#C9932E]/40 focus:border-amber-400',
          className
        )}
        style={{ }}
        {...props}
        id={id}
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
  const generated = useId()
  const id = props.id ?? generated
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
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
            : 'border-stone-200 focus:ring-[#C9932E]/40 focus:border-amber-400',
          className
        )}
        style={{ }}
        {...props}
        id={id}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
