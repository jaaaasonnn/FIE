/**
 * Short US dollar labels for map pins and clusters. Display only: they are
 * built from a listing's stored USD price and never feed a calculation.
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

/** "$45 to $120" for a cluster, or a single label when both ends read the same. */
export function shortUsdRange(min: number, max: number): string {
  const low = shortUsd(Math.min(min, max))
  const high = shortUsd(Math.max(min, max))
  return low === high ? low : `${low} to ${high}`
}
