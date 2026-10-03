/**
 * The "fie." wordmark, lowercase with the period, in Unbounded 900.
 * Flat brand gold (#C9932E) on every background, matching the logo mark.
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
