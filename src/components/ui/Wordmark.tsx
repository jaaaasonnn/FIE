/**
 * The "fie." wordmark, lowercase with the period, in Unbounded 900.
 * Flat logo gold (--color-logo) on every background, matching the logo mark.
 */
export function Wordmark({
  size = '1.5rem',
  className = '',
}: {
  size?: string
  className?: string
}) {
  return (
    <span className={`wordmark ${className}`} style={{ fontSize: size }}>
      fie.
    </span>
  )
}

/**
 * The full logo: mountain mark + "fie." wordmark, vertically centred.
 * `height` is the mark's height in px; the wordmark is sized from it so its
 * letters always stay shorter than the mark.
 */
export function Logo({ height = 24, className = '' }: { height?: number; className?: string }) {
  return (
    <span className={`logo ${className}`} style={{ fontSize: height }}>
      <span className="logo-mark" aria-hidden />
      <span className="wordmark">fie.</span>
    </span>
  )
}
