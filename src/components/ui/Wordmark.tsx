/**
 * The "fie." wordmark, lowercase with the period, in Unbounded 900.
 *
 * gloss: large, standalone usage (nav, footer, auth screens). Glossy gold gradient.
 * solid: small or text-adjacent usage where legibility has to be guaranteed.
 *        Solid Deep Gold, no gradient.
 */
export function Wordmark({
  variant = 'gloss',
  size = '1.5rem',
  className = '',
}: {
  variant?: 'gloss' | 'solid'
  size?: string
  className?: string
}) {
  return (
    <span
      className={`wordmark ${variant === 'gloss' ? 'wordmark-gloss' : 'wordmark-solid'} ${className}`}
      style={{ fontSize: size }}
    >
      fie.
    </span>
  )
}
