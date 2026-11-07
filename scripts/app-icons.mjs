// The installed app's icons (app shell stage 4), drawn from src/app/icon.png (the mark, transparent, 512 px) onto
// the brand's off-white, so no icon has a transparent corner (iOS fills those with black). Drawn with Chromium's
// canvas (Playwright, already installed for the tests); nothing else is needed.
//
//   node scripts/app-icons.mjs            writes the icons
//   node scripts/app-icons.mjs --preview  also writes a preview sheet to e2e/.reports/stage4-icons/
//
// - public/icons/icon-192.png, icon-512.png: the favicon's own layout (purpose "any")
// - public/icons/maskable-192.png, maskable-512.png: the mark smaller, every pixel of it inside the circle of 40% of
//   the width that Android keeps whatever shape it cuts (purpose "maskable"; checked in e2e/tests/journeys/installable.spec.ts)
// - src/app/apple-icon.png: 180 px for the iPhone home screen (Next adds the link from its name)
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export const ICON_BACKGROUND = '#FAF7F2'
/** The share of the width, from the middle, that the furthest pixel of the mark may reach on a maskable icon (Android
 * keeps a circle of radius 0.4; a little room is left inside it) */
export const MASKABLE_REACH = 0.36

const source = `data:image/png;base64,${readFileSync('src/app/icon.png').toString('base64')}`
const preview = process.argv.includes('--preview')

const browser = await chromium.launch()
const page = await browser.newPage()
const out = await page.evaluate(async ({ source, background, reach }) => {
  const img = new Image()
  img.src = source
  await img.decode()
  const S = img.width
  const probe = Object.assign(document.createElement('canvas'), { width: S, height: S }).getContext('2d')
  probe.drawImage(img, 0, 0)
  const data = probe.getImageData(0, 0, S, S).data
  let x0 = S, y0 = S, x1 = 0, y1 = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (data[(y * S + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2
  let far = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (data[(y * S + x) * 4 + 3] > 0) far = Math.max(far, Math.hypot(x + 0.5 - cx, y + 0.5 - cy))

  const draw = (size, maskable) => {
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size })
    const g = c.getContext('2d')
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.fillStyle = background
    g.fillRect(0, 0, size, size)
    if (maskable) {
      const k = (reach * size) / far
      g.drawImage(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1, size / 2 - (cx - x0) * k, size / 2 - (cy - y0) * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k)
    } else g.drawImage(img, 0, 0, size, size)
    return c.toDataURL('image/png').split(',')[1]
  }
  return {
    'public/icons/icon-192.png': draw(192, false),
    'public/icons/icon-512.png': draw(512, false),
    'public/icons/maskable-192.png': draw(192, true),
    'public/icons/maskable-512.png': draw(512, true),
    'src/app/apple-icon.png': draw(180, false),
  }
}, { source, background: ICON_BACKGROUND, reach: MASKABLE_REACH })

mkdirSync('public/icons', { recursive: true })
for (const [file, b64] of Object.entries(out)) writeFileSync(file, Buffer.from(b64, 'base64'))
console.log(`wrote ${Object.keys(out).join(', ')}`)

if (preview) {
  const dir = 'e2e/.reports/stage4-icons'
  mkdirSync(dir, { recursive: true })
  const img = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`
  // The masks as the phones cut them: Android's circle and rounded square, the iPhone's rounded square (about 22.5%
  // of the width), each at home-screen size and large, on a light and a dark wallpaper
  const tile = (label, file, radius, size) => `<figure><div class="w" style="width:${size}px;height:${size}px"><img src="${img(file)}" style="border-radius:${radius}"></div><figcaption>${label}</figcaption></figure>`
  const row = (title, size) => `<h2>${title}</h2><div class="row">${[
    tile('icon-512 (any), square', 'public/icons/icon-512.png', '0', size),
    tile('icon-512 (any), Android circle', 'public/icons/icon-512.png', '50%', size),
    tile('maskable-512, square (whole)', 'public/icons/maskable-512.png', '0', size),
    tile('maskable-512, Android circle', 'public/icons/maskable-512.png', '50%', size),
    tile('maskable-512, Android rounded square', 'public/icons/maskable-512.png', '18%', size),
    tile('maskable-192, Android circle', 'public/icons/maskable-192.png', '50%', size),
    tile('apple-icon 180, iPhone', 'src/app/apple-icon.png', '22.5%', size),
  ].join('')}</div>`
  const html = `<!doctype html><style>
    body{margin:0;padding:24px;font:14px system-ui;color:#1F1B16}
    .light{background:#E9E4DA}.dark{background:#1C1C1E;color:#fff}
    section{padding:16px 24px 24px;border-radius:16px;margin-bottom:16px}
    .row{display:flex;gap:28px;flex-wrap:wrap}
    figure{margin:0;width:180px}
    .w{position:relative}
    .w img{width:100%;height:100%;display:block}
    figcaption{margin-top:8px;font-size:12px}
    .safe{position:absolute;inset:10%;border:1px dashed #d33;border-radius:50%}
  </style>
  <h1>FieGH app icons (stage 4)</h1>
  <p>Drawn from src/app/icon.png onto ${ICON_BACKGROUND} by scripts/app-icons.mjs. Maskable: the mark reaches ${MASKABLE_REACH * 100}% of the width from the middle; the dashed circle is Android's safe zone (40%).</p>
  <section class="light">${row('Home-screen size (60 px), light wallpaper', 60)}${row('Large (180 px), light wallpaper', 180)}</section>
  <section class="dark">${row('Home-screen size (60 px), dark wallpaper', 60)}${row('Large (180 px), dark wallpaper', 180)}</section>
  <section class="light"><h2>Maskable with Android's safe zone drawn</h2><div class="row"><figure><div class="w" style="width:256px;height:256px"><img src="${img('public/icons/maskable-512.png')}"><div class="safe"></div></div><figcaption>maskable-512 and the 80% circle</figcaption></figure></div></section>`
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.setContent(html)
  await page.screenshot({ path: `${dir}/preview.png`, fullPage: true })
  for (const f of Object.keys(out)) writeFileSync(`${dir}/${f.split('/').pop()}`, readFileSync(f))
  console.log(`preview: ${dir}/preview.png`)
}
await browser.close()
