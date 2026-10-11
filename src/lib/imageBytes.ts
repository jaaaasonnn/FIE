// What a file really is, read from its first bytes. A browser says what type
// an upload is, and anyone can make it say anything: this is what the upload
// routes go by instead.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** The image type the bytes begin as, or null if they are none of the three we accept. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (offset: number, ...expected: number[]) => expected.every((byte, i) => bytes[offset + i] === byte)
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

export const NOT_AN_IMAGE = 'That file is not a JPG, PNG or WEBP image.'

/**
 * An upload's bytes and its real type. Null when the contents are not one of
 * the three image types, or are not the type the upload claimed to be.
 */
export async function readImage(file: File): Promise<{ buffer: Buffer; type: ImageType } | null> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const type = sniffImage(buffer)
  if (!type || type !== file.type) return null
  return { buffer, type }
}
