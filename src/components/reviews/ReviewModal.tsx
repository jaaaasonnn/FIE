'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Star, X, Loader2 } from 'lucide-react'

export type ReviewType = 'GUEST_TO_HOST' | 'HOST_TO_GUEST'

interface ReviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  type: ReviewType
  revieweeName: string
  onSubmitted: (bookingId: string) => void
  onAlreadyReviewed: (bookingId: string) => void
}

// Used for both directions (GUEST_TO_HOST and HOST_TO_GUEST) — the API
// already distinguishes type via the `type` field, this just supplies it.
export function ReviewModal({
  open,
  onOpenChange,
  bookingId,
  type,
  revieweeName,
  onSubmitted,
  onAlreadyReviewed,
}: ReviewModalProps) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyReviewed, setAlreadyReviewed] = useState(false)

  function reset() {
    setRating(0)
    setHoverRating(0)
    setComment('')
    setSubmitting(false)
    setError(null)
    setAlreadyReviewed(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleSubmit() {
    if (rating < 1) {
      setError('Please select a star rating')
      return
    }
    if (!comment.trim()) {
      setError('Please add a comment')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, rating, comment: comment.trim(), type }),
      })
      const data = await res.json()

      if (res.status === 409) {
        setAlreadyReviewed(true)
        onAlreadyReviewed(bookingId)
        return
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit review')
      }

      onSubmitted(bookingId)
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="p-6">
            <div className="flex items-start justify-between mb-1">
              <Dialog.Title className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {type === 'GUEST_TO_HOST' ? `Review ${revieweeName}` : `Review your guest, ${revieweeName}`}
              </Dialog.Title>
              <Dialog.Close
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-stone-100 flex-shrink-0"
                aria-label="Close"
              >
                <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
              </Dialog.Close>
            </div>

            {alreadyReviewed ? (
              <div className="py-6 text-center">
                <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  You&apos;ve already reviewed this stay
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Thanks — your review has already been submitted.
                </p>
                <button
                  onClick={() => handleOpenChange(false)}
                  className="mt-4 px-5 py-2 rounded-full text-sm font-semibold"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                  {type === 'GUEST_TO_HOST'
                    ? 'How was your stay? Your feedback helps other guests.'
                    : 'How was hosting this guest? Your feedback helps other hosts.'}
                </p>

                <div className="flex items-center gap-1 mb-4" role="radiogroup" aria-label="Star rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHoverRating(n)}
                      onMouseLeave={() => setHoverRating(0)}
                      aria-label={`${n} star${n === 1 ? '' : 's'}`}
                      className="p-0.5"
                    >
                      <Star
                        size={30}
                        fill={(hoverRating || rating) >= n ? 'var(--color-accent)' : 'none'}
                        color={(hoverRating || rating) >= n ? 'var(--color-accent)' : '#D4C9B8'}
                      />
                    </button>
                  ))}
                </div>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={type === 'GUEST_TO_HOST' ? 'Share details of your stay…' : 'Share what it was like hosting this guest…'}
                  rows={4}
                  className="w-full rounded-xl border p-3 text-sm resize-none focus:outline-none focus:ring-2"
                  style={{ borderColor: '#E5E7EB', color: 'var(--color-text-primary)' }}
                />

                {error && (
                  <p className="text-sm mt-2" style={{ color: '#991B1B' }}>{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  {submitting ? 'Submitting…' : 'Submit Review'}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
