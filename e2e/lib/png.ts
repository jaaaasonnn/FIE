import zlib from 'zlib'

// Reads a PNG's pixels (8-bit RGB or RGBA, not interlaced: what scripts/app-icons.mjs and the browser write), so the
// tests can check the installed app's icons pixel by pixel without an image library (stage 4).

export type Pixels = { width: number; height: number; channels: number; at: (x: number, y: number) => [number, number, number, number] }

export function readPng(file: Buffer): Pixels {
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let i = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0
  const data: Buffer[] = []
  while (i < file.length) {
    const length = file.readUInt32BE(i)
    const kind = file.toString('ascii', i + 4, i + 8)
    const body = file.subarray(i + 8, i + 8 + length)
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12] }
    if (kind === 'IDAT') data.push(body)
    if (kind === 'IEND') break
    i += 12 + length
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG: depth ${depth}, colour type ${type}, interlace ${interlace}`)
  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[y * stride + x] = v & 255
    }
  }
  return {
    width, height, channels,
    at: (x, y) => {
      const o = (y * width + x) * channels
      return [out[o], out[o + 1], out[o + 2], channels === 4 ? out[o + 3] : 255]
    },
  }
}

/** Writes 8-bit RGBA pixels as a PNG (for a picture of where two screenshots differ) */
export function writePng(width: number, height: number, rgba: Buffer): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (kind: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const kb = Buffer.concat([Buffer.from(kind, 'ascii'), body])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(kb))
    return Buffer.concat([len, kb, sum])
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * How many pixels differ between two PNGs of one size by more than `noise` colour levels in any channel (and how many
 * by `noise` or less, but not 0), with a picture of where (red: over `noise`; yellow: within it), or null if the sizes
 * differ. Two screenshots of one build in Chromium differ by one level at a few anti-aliased edges (stage 4).
 */
export function comparePng(a: Buffer, b: Buffer, noise = 0): { differ: number; withinNoise: number; picture: Buffer } | null {
  const x = readPng(a), y = readPng(b)
  if (x.width !== y.width || x.height !== y.height) return null
  const out = Buffer.alloc(x.width * x.height * 4)
  let differ = 0, withinNoise = 0
  for (let j = 0; j < x.height; j++) for (let i = 0; i < x.width; i++) {
    const p = x.at(i, j), q = y.at(i, j), o = (j * x.width + i) * 4
    const most = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]), Math.abs(p[3] - q[3]))
    if (most > noise) differ++
    else if (most > 0) withinNoise++
    const [r, g, bl] = most > noise ? [255, 0, 0] : most > 0 ? [255, 210, 0] : [p[0] >> 2, p[1] >> 2, p[2] >> 2]
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255
  }
  return { differ, withinNoise, picture: writePng(x.width, x.height, out) }
}
