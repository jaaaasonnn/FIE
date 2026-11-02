/**
 * FieGH's mark, the three roofs of the logo (public/logo-mark.png), drawn as strokes on a 24-pixel grid for
 * the phone's bottom bar. Inactive: thin strokes in the colour around it. Active: heavier strokes in gold.
 * No hooks, so a server component can draw it.
 */
export function FieMark({ active = false, size = 24, className }: { active?: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--color-accent)' : 'currentColor'}
      strokeWidth={active ? 2.6 : 1.75}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M1 20 12 6l11 14M5.5 20 12 11.7 18.5 20M10 20l2-2.6 2 2.6" />
    </svg>
  )
}
