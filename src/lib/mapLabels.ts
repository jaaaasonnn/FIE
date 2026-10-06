/**
 * Short labels for map pins (US dollars) and clusters (a count of homes).
 * Display only: prices are built from a listing's stored USD price and never
 * feed a calculation.
 */

/** "$45", "$1.4k", "$12k", "$1.2m". Whole dollars under a thousand. */
export function shortUsd(amount: number): string {
  const n = Math.round(amount)
  if (n < 1000) return `$${n}`
  if (n < 1_000_000) return `$${trim(n / 1000, n < 10_000)}k`
  return `$${trim(n / 1_000_000, n < 10_000_000)}m`
}

/** One decimal for small values ("1.4"), none when it would be ".0". */
function trim(value: number, oneDecimal: boolean): string {
  const text = oneDecimal ? value.toFixed(1) : Math.round(value).toString()
  return text.replace(/\.0$/, '')
}

/** The number of homes in a cluster: "3", "42", and "99+" past two digits. */
export function clusterLabel(count: number): string {
  const n = Math.max(0, Math.floor(count))
  return n > 99 ? '99+' : String(n)
}
