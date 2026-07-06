import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'

const input = 'public/logo.png'
const output = 'public/logo.png'

const img = sharp(input)
const { width, height } = await img.metadata()

const { data, info } = await img
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const channels = info.channels // 4 (RGBA)
const buf = Buffer.from(data)

// Sample background color from the top-left corner pixel
const bgR = buf[0], bgG = buf[1], bgB = buf[2]
console.log(`Background color sampled: rgb(${bgR}, ${bgG}, ${bgB})`)

const threshold = 40 // tolerance

for (let i = 0; i < buf.length; i += channels) {
  const r = buf[i], g = buf[i+1], b = buf[i+2]
  const dist = Math.sqrt(
    (r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2
  )
  if (dist < threshold) {
    buf[i + 3] = 0 // make transparent
  }
}

await sharp(buf, { raw: { width: info.width, height: info.height, channels } })
  .png()
  .toFile(output + '.tmp.png')

// Replace the original
import { renameSync } from 'fs'
renameSync(output + '.tmp.png', output)

console.log('Done! Background removed.')
