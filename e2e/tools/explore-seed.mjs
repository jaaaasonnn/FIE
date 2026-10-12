// Makes a few people and a home in the LOCAL test database to look at pages with. Prints their sign-in details.
// node e2e/run.mjs exec node e2e/tools/explore-seed.mjs
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
if (!process.env.DATABASE_URL?.includes('127.0.0.1:54329/fiegh_e2e')) throw new Error('not the test database')
const db = new PrismaClient()
const B = 'http://localhost:3200'
const tag = Date.now().toString(36)
const ip = () => `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(cookie, method, path, body) {
  const r = await fetch(B + path, { method, headers: { origin: B, 'content-type': 'application/json', 'x-vercel-forwarded-for': ip(), ...(cookie ? { cookie: `fiegh_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text, headers: r.headers }
}
const out = {}
for (const [who, role] of [['guest', 'GUEST'], ['host', 'HOST'], ['admin', 'GUEST']]) {
  const email = `e2e-explore-${who}-${tag}@fiegh.test`, password = `Explore-pass-${tag}`
  const r = await call(null, 'POST', '/api/auth/signup', { name: `E2E Explore ${who}`, email, password, role })
  const s = await call(null, 'POST', '/api/auth/signin', { identifier: email, password })
  out[who] = { id: r.json.user.id, email, password, cookie: /fiegh_session=([^;]+)/.exec(s.headers.get('set-cookie'))[1] }
}
await db.user.update({ where: { id: out.admin.id }, data: { role: 'ADMIN' } })
const l = await call(out.host.cookie, 'POST', '/api/listings', { title: `E2E Explore home ${tag}`, description: 'A quiet two-bedroom flat used to look at pages. Not a real home.', propertyType: 'Apartment', region: 'Central', city: 'Cape Coast', neighbourhood: 'Pedu', bedrooms: 2, bathrooms: 1, maxGuests: 4, rentalModes: ['SHORT_STAY'], priceNightly: 80, instantBook: true, lat: 5.1053, lng: -1.2466, photos: ['https://images.unsplash.com/photo-1506126208421-3345d63a05d8?w=1200&q=80'] })
out.listing = l.json?.listing?.id ?? l.text
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const b = await call(out.guest.cookie, 'POST', '/api/bookings', { listingId: out.listing, rentalMode: 'SHORT_STAY', checkIn: d(40), checkOut: d(42) })
out.booking = b.json?.booking?.id ?? b.text
fs.writeFileSync(new URL('../.state/explore.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(JSON.stringify({ ...out, guest: { ...out.guest, cookie: '…' }, host: { ...out.host, cookie: '…' }, admin: { ...out.admin, cookie: '…' } }))
await db.$disconnect()
