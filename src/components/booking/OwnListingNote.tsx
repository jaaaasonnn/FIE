import Link from 'next/link'

/** Shown to a host in place of the booking box or payment form on their own listing. */
export function OwnListingNote({ listingId }: { listingId: string }) {
  return (
    <div>
      <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>This is your listing</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Hosts cannot book their own homes.
      </p>
      <Link
        href={`/dashboard/host/listings/${listingId}/edit`}
        className="focus-ring rounded-sm inline-block mt-4 text-sm font-semibold underline underline-offset-4 decoration-1"
        style={{ color: 'var(--color-accent-deep)' }}
      >
        Manage this listing
      </Link>
    </div>
  )
}
