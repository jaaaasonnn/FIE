// The heart on a card's photo as the server draws it before its code has come (components/listing/HeartButton.tsx
// takes its place): the same size and look, not yet pressable. Its own file, so a page that shows it does not
// carry the heart's code (app/search/SearchClient.tsx fetches that on a phone only).
export function HeartPlaceholder({ title, className = '' }: { listingId?: string; title: string; className?: string }) {
  return (
    <button type="button" disabled aria-pressed={false} aria-label={`Save ${title} to your wishlist`} className={`heart-button focus-ring ${className}`}>
      <span className="heart-button-face" aria-hidden />
    </button>
  )
}
