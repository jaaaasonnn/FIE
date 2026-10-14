// Limits on the things anyone can do over and over: guessing passwords,
// making accounts, holding dates without paying, sending messages. The counts
// are kept in the AuthRequest table (the same one the email-link limits use),
// so they hold across every server and need nothing new.
//
// Nothing here stores an IP address or an email: only hashes of them.

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MIN = 60 * 1000
const HOUR = 60 * MIN

const MESSAGES_PER_HOUR = 30

export const LIMITS = {
  /** Wrong passwords for one account (or one email or phone that has none) */
  signInPerAccount: { max: 5, windowMs: 15 * MIN },
  /** Wrong passwords from one IP address, whatever accounts they were for */
  signInPerIp: { max: 20, windowMs: HOUR },
  /** Accounts made from one IP address */
  signUpPerIp: { max: 5, windowMs: HOUR },
  /** Bookings one guest may have that are confirmed and waiting to be paid for */
  openUnpaidBookings: 2,
  /** Requests one guest may have that a host has not answered yet */
  openRequests: 5,
  /** Bookings one guest may make in an hour, however they end */
  bookingsPerHour: 10,
  /** Messages one person may send in an hour */
  messagesPerHour: MESSAGES_PER_HOUR,
  messagesPerSender: { max: MESSAGES_PER_HOUR, windowMs: HOUR },
  /** SMS delivery reports one IP address may send that are refused (a bad link or a wrong id) before it is refused outright */
  smsReportRefusalsPerIp: { max: 20, windowMs: HOUR },
} as const

export const SIGN_IN_FAILED = 'SIGN_IN_FAILED'
export const SIGN_UP = 'SIGN_UP'
export const MESSAGE_SENT = 'MESSAGE_SENT'
export const SMS_REPORT_REFUSED = 'SMS_REPORT_REFUSED'

export const TOO_MANY_SIGN_INS = 'Too many sign-in attempts. Please wait 15 minutes and try again, or reset your password.'
export const TOO_MANY_SIGN_UPS = 'Too many accounts have been created from this connection. Please try again in an hour.'
export const TOO_MANY_OPEN_BOOKINGS = `You already have ${LIMITS.openUnpaidBookings} bookings that are not paid for yet. Pay for one, or cancel it, before making another.`
export const TOO_MANY_OPEN_REQUESTS = `You already have ${LIMITS.openRequests} requests waiting for a host's answer. Wait for an answer, or cancel one, before making another.`
export const TOO_MANY_BOOKINGS = 'You have made a lot of bookings in the last hour. Please try again later.'
/** The longest one message may be. */
export const MAX_MESSAGE_LENGTH = 2000
export const NO_REASON_TO_MESSAGE = 'You can message a host about one of their homes, or the other person on one of your bookings.'
export const TOO_MANY_MESSAGES = 'You have sent a lot of messages in the last hour. Please try again later.'

/**
 * What a sign-in attempt is counted against: a hash of the email or phone as
 * typed, not a user id. An address with no account is counted and locked just
 * like one that has, so the lock gives nothing away about who has an account.
 */
export function signInKey(identifier: string): string {
  return `signin:${crypto.createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:${identifier.trim().toLowerCase()}`).digest('hex')}`
}

/** How many of one kind were recorded for this key, or from this IP address, in the window. */
export async function countRecent(
  kind: string, by: { key: string } | { ipHash: string }, windowMs: number, now: Date = new Date(),
): Promise<number> {
  return db.authRequest.count({
    where: { kind, createdAt: { gte: new Date(now.getTime() - windowMs) }, ...('key' in by ? { userId: by.key } : { ipHash: by.ipHash }) },
  })
}

export async function record(kind: string, { key = null, ipHash = null }: { key?: string | null; ipHash?: string | null }, now: Date = new Date()): Promise<void> {
  await db.authRequest.create({ data: { kind, userId: key, ipHash, createdAt: now } })
}

type Window = { max: number; windowMs: number }
export type Claim = { ok: true; release: () => Promise<void> } | { ok: false }

/**
 * Counts this attempt FIRST, then asks whether that was one too many.
 *
 * Counting first and acting afterwards ("how many so far? fine, go on, then
 * write it down") lets any number of requests sent at the same instant all
 * read the same count and all go on. Here each request writes its own row
 * before it counts, so it counts itself and every row written before it: of
 * `max + n` requests at one instant, at most `max` can find themselves within
 * the limit. It needs no lock and no transaction. In a burst it can refuse a
 * little early (fewer than `max` get through), never late.
 *
 * A refused attempt takes its own row away again, so being refused does not
 * keep the lock going. `release` does the same for an attempt that turns out
 * not to count (a right password, a message that was not sent).
 */
export async function claim(
  kind: string,
  { key = null, ipHash = null }: { key?: string | null; ipHash?: string | null },
  limits: { perKey?: Window; perIp?: Window },
  now: Date = new Date(),
): Promise<Claim> {
  const row = await db.authRequest.create({ data: { kind, userId: key, ipHash, createdAt: now } })
  const release = async () => { await db.authRequest.deleteMany({ where: { id: row.id } }) }
  const [forKey, fromIp] = await Promise.all([
    key && limits.perKey ? countRecent(kind, { key }, limits.perKey.windowMs, now) : 0,
    ipHash && limits.perIp ? countRecent(kind, { ipHash }, limits.perIp.windowMs, now) : 0,
  ])
  // Each count includes this attempt's own row
  if ((limits.perKey && forKey > limits.perKey.max) || (limits.perIp && fromIp > limits.perIp.max)) {
    await release()
    return { ok: false }
  }
  return { ok: true, release }
}

/** The answer when a limit is reached: 429, with how long to wait. */
export function tooMany(message: string, retryAfterSeconds: number): NextResponse {
  return NextResponse.json({ error: message }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } })
}
