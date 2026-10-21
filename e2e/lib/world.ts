// People and things for a test, made through the app's own API wherever the
// test is about that step, and straight in the test database where it is only
// set-up (an admin role, an ID already approved, a payout method a day old).
// Everything made here is removed by id when the test ends.
import crypto from 'crypto'
import { db, purge } from './db'
import { fakes, until } from './fakes'

export const APP = ['http://localhost:3200', 'http://localhost:3201'] as const
export const CRON_SECRET = process.env.CRON_SECRET ?? 'e2e-cron-secret'
const RUN = crypto.randomBytes(3).toString('hex')
let counter = 0
const unique = () => `${RUN}${process.pid.toString(36)}${(++counter).toString(36)}`
/** A client address nobody else in this run uses, sent in the header the app reads first (x-vercel-forwarded-for). */
export const freshIp = () => `10.${crypto.randomInt(1, 254)}.${crypto.randomInt(1, 254)}.${crypto.randomInt(1, 254)}`

export type Reply<T = any> = { status: number; json: T; text: string; headers: Headers }
export type CallOptions = { server?: 0 | 1; form?: FormData; headers?: Record<string, string>; raw?: string; /** Give up after this long: the answer then has status 0 */ timeoutMs?: number }

export async function call(method: string, path: string, body?: unknown, o: CallOptions & { cookie?: string | null; ip?: string } = {}): Promise<Reply> {
  const base = APP[o.server ?? 0]
  const headers: Record<string, string> = { origin: base, 'x-vercel-forwarded-for': o.ip ?? freshIp(), ...(o.headers ?? {}) }
  if (o.cookie) headers.cookie = `fiegh_session=${o.cookie}`
  let payload: BodyInit | undefined
  if (o.form) payload = o.form
  else if (o.raw !== undefined) { headers['content-type'] ??= 'application/json'; payload = o.raw }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  let res: Response
  try {
    res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual', signal: o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined })
  } catch (error) {
    // No answer at all: the server is down, or it took longer than the test allowed
    return { status: 0, json: null, text: `no answer: ${(error as Error).name} ${(error as Error).message}`, headers: new Headers() }
  }
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers }
}

export const cron = (job: string, o: { server?: 0 | 1; dryRun?: boolean; timeoutMs?: number } = {}) =>
  call('GET', `/api/cron/${job}${o.dryRun ? '?dryRun=1' : ''}`, undefined, { server: o.server, timeoutMs: o.timeoutMs, headers: { authorization: `Bearer ${CRON_SECRET}` } })

export class Actor {
  cookie: string | null = null
  ip = freshIp()
  constructor(public id: string, public email: string, public password: string, public name: string, public role: string) {}
  call(method: string, path: string, body?: unknown, o: CallOptions = {}) { return call(method, path, body, { ...o, cookie: this.cookie, ip: this.ip }) }
  async signIn(o: { server?: 0 | 1 } = {}): Promise<Reply> {
    const r = await call('POST', '/api/auth/signin', { identifier: this.email, password: this.password }, { ip: this.ip, server: o.server })
    const cookie = /fiegh_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]
    if (r.status === 200 && cookie) this.cookie = cookie
    return r
  }
  /** Emails the fake Resend received for this person, after the send job has run. */
  async inbox(subjectIncludes?: string) {
    await cron('send-messages')
    const mail = await fakes.inbox(this.email)
    return subjectIncludes ? mail.filter((m) => m.subject.includes(subjectIncludes)) : mail
  }
  /** Waits for an email whose subject or text matches, and returns every one that does. Messages are written after the response, so this asks until it is there. */
  async mail(matching: RegExp) {
    return until(async () => { const found = (await this.inbox()).filter((m) => matching.test(`${m.subject}\n${m.text ?? ''}`)); return found.length ? found : null }, `an email matching ${matching} to ${this.email}`, 15_000)
  }
  /** The link in the newest email with this subject. Waits for it to arrive. */
  async linkFrom(subjectIncludes: string): Promise<string> {
    const mail = await until(async () => (await this.inbox(subjectIncludes)).at(-1), `an email "${subjectIncludes}" to ${this.email}`, 30_000)
    const link = /https?:\/\/\S+token=[\w-]+/.exec(mail.text ?? '')?.[0]
    if (!link) throw new Error(`No link in the email "${mail.subject}"`)
    return link
  }
}

export type ListingInput = Partial<{ title: string; instantBook: boolean; priceNightly: number; priceMonthly: number; priceAnnual: number; rentalModes: string[]; damageDeposit: number; cancellationPolicy: string; city: string; region: string; minStayNights: number; advanceMonthsRequired: number; lat: number; lng: number; digitalAddress: string }>
export const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

export class World {
  people: Actor[] = []
  private used = new Set<number>()

  /** Days from today that no other booking in this test uses yet. */
  dates(nights = 2): { checkIn: string; checkOut: string } {
    let start = 30 + crypto.randomInt(0, 300)
    while ([...Array(nights + 1).keys()].some((n) => this.used.has(start + n))) start += nights + 1
    for (let n = 0; n <= nights; n++) this.used.add(start + n)
    return { checkIn: day(start), checkOut: day(start + nights) }
  }

  /** `tag` ends up in the email address, for a test that must tell the fakes about a person before they exist. */
  async person(role: 'GUEST' | 'HOST', over: { name?: string; phone?: string; tag?: string } = {}): Promise<Actor> {
    const tag = over.tag ?? unique()
    const actor = new Actor('', `e2e-${role.toLowerCase()}-${tag}@fiegh.test`, `E2e-pass-${tag}`, over.name ?? `E2E ${role === 'HOST' ? 'Host' : 'Guest'} ${tag}`, role)
    const r = await call('POST', '/api/auth/signup', { name: actor.name, email: actor.email, password: actor.password, role, ...(over.phone ? { phone: over.phone } : {}) }, { ip: actor.ip })
    if (r.status !== 201) throw new Error(`sign-up failed: ${r.status} ${r.text}`)
    actor.id = r.json.user.id
    this.people.push(actor)
    const s = await actor.signIn()
    if (s.status !== 200) throw new Error(`sign-in failed: ${s.status} ${s.text}`)
    return actor
  }
  guest(over: { name?: string; tag?: string } = {}) { return this.person('GUEST', over) }

  /** A host. By default ready to be paid: ID approved by an admin on record, payout method more than a day old. */
  async host(o: { idApproved?: boolean; payoutMethod?: boolean; name?: string } = {}): Promise<Actor> {
    const host = await this.person('HOST', { name: o.name })
    if (o.idApproved !== false) await this.approveId(host)
    if (o.payoutMethod !== false) await this.givePayoutMethod(host)
    return host
  }
  async admin(): Promise<Actor> {
    const admin = await this.person('GUEST', { name: `E2E Admin ${unique()}` })
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } })
    admin.role = 'ADMIN'
    return admin
  }
  /** Set-up only: the state an admin's approval leaves behind (src/lib/hostId.ts). The real flow has its own tests. */
  async approveId(host: Actor): Promise<void> {
    const reviewer = this.people.find((p) => p.role === 'ADMIN') ?? await this.admin()
    await db.verification.upsert({
      where: { userId: host.id },
      create: { userId: host.id, idType: 'GHANA_CARD', idPhotoUrl: `${host.id}/e2e-id.jpg`, status: 'APPROVED', reviewedById: reviewer.id },
      update: { status: 'APPROVED', reviewedById: reviewer.id },
    })
    await db.user.update({ where: { id: host.id }, data: { isVerified: true } })
  }
  /** Set-up only: a payout method saved two days ago, so the 24-hour wait is over. */
  async givePayoutMethod(host: Actor, ageHours = 48): Promise<void> {
    await db.user.update({
      where: { id: host.id },
      data: { payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0240000001', paystackRecipientCode: `RCP_e2e_${host.id}`, payoutMethodVerifiedAt: new Date(Date.now() - ageHours * 3_600_000) },
    })
  }

  async listing(host: Actor, over: ListingInput = {}): Promise<{ id: string; title: string }> {
    const title = over.title ?? `E2E home ${unique()}`
    const r = await host.call('POST', '/api/listings', {
      description: 'A quiet two-bedroom flat used by the end-to-end tests. Not a real home.', propertyType: 'Apartment',
      region: over.region ?? 'Central', city: over.city ?? 'Cape Coast', neighbourhood: 'Pedu', bedrooms: 2, bathrooms: 1, maxGuests: 4,
      rentalModes: over.rentalModes ?? ['SHORT_STAY'], priceNightly: over.priceNightly ?? 80, instantBook: over.instantBook ?? true, lat: 5.1053, lng: -1.2466,
      ...over, title,
    })
    if (r.status !== 201) throw new Error(`listing failed: ${r.status} ${r.text}`)
    return { id: r.json.listing.id, title }
  }

  async book(guest: Actor, listingId: string, o: { checkIn?: string; checkOut?: string; rentalMode?: string; nights?: number; server?: 0 | 1 } = {}): Promise<Reply> {
    const dates = o.checkIn ? { checkIn: o.checkIn, checkOut: o.checkOut! } : this.dates(o.nights ?? 2)
    return guest.call('POST', '/api/bookings', { listingId, rentalMode: o.rentalMode ?? 'SHORT_STAY', ...dates }, { server: o.server })
  }

  /**
   * Books dates that are known to be free, for set-up. The app answers 409
   * "no longer available" when its Serializable transaction is aborted by
   * unrelated bookings elsewhere (finding F3), so this tries again as a guest
   * would. Tests about the booking step itself use `book` and see every answer.
   */
  async mustBook(guest: Actor, listingId: string, o: { checkIn?: string; checkOut?: string; rentalMode?: string; nights?: number } = {}): Promise<string> {
    const dates = o.checkIn ? { checkIn: o.checkIn, checkOut: o.checkOut! } : this.dates(o.nights ?? 2)
    let last: Reply | undefined
    for (let attempt = 0; attempt < 8; attempt++) {
      last = await this.book(guest, listingId, { ...o, ...dates })
      if (last.status === 201) return last.json.booking.id
      if (last.status !== 409) break
    }
    throw new Error(`booking failed: ${last?.status} ${last?.text}`)
  }

  /** Starts a payment through the app. Returns the reference the fake Paystack was given. */
  async startPayment(guest: Actor, bookingId: string, o: { instalmentId?: string; method?: string; server?: 0 | 1; timeoutMs?: number } = {}): Promise<Reply & { reference?: string }> {
    const r = await guest.call('POST', '/api/payments', { bookingId, method: o.method ?? 'CARD', ...(o.instalmentId ? { instalmentId: o.instalmentId } : {}) }, { server: o.server, timeoutMs: o.timeoutMs })
    const reference = r.json?.reference ?? r.json?.payment?.gatewayReference ?? (r.status < 300 ? (await fakes.tx(bookingId)).at(-1)?.reference : undefined)
    return { ...r, reference }
  }
  /** The guest's browser coming back from Paystack. */
  verify(guest: Actor, reference: string, o: { server?: 0 | 1; timeoutMs?: number } = {}) {
    return guest.call('GET', `/api/payments/verify?reference=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(reference)}`, undefined, { server: o.server, timeoutMs: o.timeoutMs })
  }
  /** Books (instant), pays at the fake Paystack and comes back: a confirmed, paid booking. */
  async paidBooking(guest: Actor, listingId: string, o: { nights?: number; rentalMode?: string; checkIn?: string; checkOut?: string } = {}): Promise<{ id: string; reference: string }> {
    const id = await this.mustBook(guest, listingId, o)
    const pay = await this.startPayment(guest, id)
    if (!pay.reference) throw new Error(`payment did not start: ${pay.status} ${pay.text}`)
    await fakes.setTx(pay.reference, { status: 'success' })
    await this.verify(guest, pay.reference)
    const row = await db.booking.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true } })
    if (row.paymentStatus !== 'PAID') throw new Error(`booking ${id} is ${row.status}/${row.paymentStatus} after paying`)
    return { id, reference: pay.reference }
  }

  /**
   * Removes this test's people and everything of theirs, by id. Admins are
   * left until the whole run is over (lib/global-teardown.ts): the app tells
   * "every admin" about things, and an admin removed by one test while
   * another test's request is half way through writing those notices would
   * make that request fail for a reason that has nothing to do with it.
   */
  async cleanup(): Promise<void> {
    await purge(this.people.filter((p) => p.role !== 'ADMIN').map((p) => p.id).filter(Boolean))
    this.people = []
  }
}
