export const MAX_RAW_PHOTO_BYTES = 15 * 1024 * 1024 // sanity cap before we even try to compress
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const MAX_DIMENSION = 1080
const JPEG_QUALITY = 0.82

// Downscales to at most MAX_DIMENSION on the long edge and re-encodes as
// JPEG, so large phone photos don't need to be manually resized before
// upload — this also normalizes everything to one predictable format.
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to compress image'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}
