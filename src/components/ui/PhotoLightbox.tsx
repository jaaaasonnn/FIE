'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

interface PhotoLightboxProps {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Simple "view larger" lightbox — no pinch/pan, just an enlarged, centered
// photo over a dimmed backdrop. Click-outside, the close button, and Escape
// all dismiss it (the last two are handled by Radix Dialog for free).
export function PhotoLightbox({ src, alt, open, onOpenChange }: PhotoLightboxProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="lightbox-overlay fixed inset-0 z-50 bg-black/70"
        />
        <Dialog.Content
          className="lightbox-content fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[min(90vw,32rem)] max-h-[85vh] focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{alt}</Dialog.Title>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-white">
            <img src={src} alt={alt} className="block w-full h-full max-h-[85vh] object-contain" />
            <Dialog.Close
              className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-colors bg-black/55 hover:bg-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-white/60"
              aria-label="Close"
            >
              <X size={18} color="#fff" />
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
