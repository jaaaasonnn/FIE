// Prints what a page offers (headings, fields, buttons, links), to write tests against. Local stack only.
// node e2e/run.mjs exec node e2e/tools/dump.mjs <path> [email password]
import { chromium } from '@playwright/test'
const [path, email, password] = process.argv.slice(2)
const B = 'http://localhost:3200'
const browser = await chromium.launch()
const context = await browser.newContext({ extraHTTPHeaders: { 'x-vercel-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } })
await context.route(/^https:\/\/(api\.maptiler\.com|images\.unsplash\.com|e2e-storage\.fiegh\.test)\//, (r) => r.fulfill({ status: 204, body: '' }))
if (email) {
  const r = await fetch(`${B}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ identifier: email, password }) })
  const cookie = /fiegh_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]
  if (!cookie) { console.log('sign-in failed', r.status); process.exit(1) }
  await context.addCookies([{ name: 'fiegh_session', value: cookie, domain: 'localhost', path: '/' }])
}
const page = await context.newPage()
await page.goto(B + path, { waitUntil: 'networkidle' }).catch((e) => console.log('goto:', e.message.split('\n')[0]))
const out = await page.evaluate(() => {
  const t = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)
  const label = (e) => e.labels?.[0] ? t(e.labels[0]) : e.getAttribute('aria-label') || e.closest('label') && t(e.closest('label')) || ''
  return {
    url: location.pathname + location.search,
    headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${t(h)}`).slice(0, 25),
    fields: [...document.querySelectorAll('input,select,textarea')].map((e) => `${e.tagName.toLowerCase()}[type=${e.type}] name=${e.name || '-'} id=${e.id || '-'} label="${label(e)}" placeholder="${e.placeholder || ''}"`).slice(0, 40),
    buttons: [...new Set([...document.querySelectorAll('button,[role=button]')].map((b) => `${t(b) || '(icon: ' + (b.getAttribute('aria-label') || b.title || '?') + ')'}${b.disabled ? ' [disabled]' : ''}`))].slice(0, 50),
    links: [...new Set([...document.querySelectorAll('main a[href], [role=main] a[href]')].map((a) => `${t(a).slice(0, 30)} -> ${a.getAttribute('href')}`))].slice(0, 15),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, Number(new URLSearchParams(location.hash.slice(1)).get('t') || 0)),
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
