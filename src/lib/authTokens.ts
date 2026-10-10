// Links sent by email that prove someone controls an address: confirming the
// email on a new account, confirming a change of email, and resetting a
// password. This file is where those rules meet the database.
//
// What keeps them safe:
//  - A token is 32 random bytes. Only its SHA-256 hash is stored, so nothing
//    in the database can be used to follow a link.
//  - A token works once and expires. Asking for a new one cancels the last.
//  - Requests are limited per person and per IP address.
//  - Asking for a link gives the same answer whether or not the address has
//    an account, and a bad link gives the same answer whatever is wrong with
//    it, so neither can be used to find out who is registered.
//  - A link is followed by pressing a button on the page it opens (a POST),
//    so a mail scanner that fetches the link cannot use it up.
//
// The emails go out through notify (lib/messaging), like every other message:
// only logged until email is switched on, and never sent from here.

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { normalizeEmail } from '@/lib/utils'
import { notify } from '@/lib/messaging/notify'

export type TokenPurpose = 'VERIFY_EMAIL' | 'CHANGE_EMAIL' | 'RESET_PASSWORD'

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** How long each kind of link works for. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOUR,
  CHANGE_EMAIL: 24 * HOUR,
  RESET_PASSWORD: 1 * HOUR,
}

/** One link a minute and five an hour for one person; ten an hour from one IP address. */
export const USER_LIMIT_PER_MINUTE = 1
export const USER_LIMIT_PER_HOUR = 5
export const IP_LIMIT_PER_HOUR = 10

export const MIN_PASSWORD_LENGTH = 8

// ── What people are told ───────────────────────────────────────────────────
// One sentence per request, the same whatever happened behind it.

export const RESET_REQUESTED = 'If that email address has a FieGH account, we have sent it a link to reset the password. The link works for one hour.'
export const VERIFICATION_REQUESTED = 'If your email address still needs confirming, we have sent a link to it. The link works for 24 hours.'
export const EMAIL_CHANGE_REQUESTED = 'If that address can be used, we have sent a link to it. Your email changes only once you follow that link. Until then your current email stays as it is.'
export const BAD_LINK = 'This link is not valid or has expired. Please ask for a new one.'
export const EMAIL_NOT_VERIFIED = 'Please confirm your email address first. We sent a link to it when you signed up; you can send it again from your profile.'
export const EMAIL_NEEDED = 'Please add an email address to your profile and confirm it first.'

// ── Tokens ─────────────────────────────────────────────────────────────────

/** What is stored for a token: its SHA-256 hash, never the token. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * The caller's IP address, hashed. Vercel puts the address in
 * x-forwarded-for; the first entry is the client. Null when there is none.
 */
export function ipHashOf(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || req.headers.get('x-real-ip')?.trim()
  if (!ip) return null
  return crypto.createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:${ip}`).digest('hex')
}

/**
 * Records a request for a link and says whether it is within the limits.
 * Every request is recorded, allowed or not and whether or not the address
 * has an account, so the limits cannot be dodged and nothing is given away.
 */
export async function allowRequest({
  kind, userId, ipHash, now = new Date(),
}: {
  kind: TokenPurpose
  userId: string | null
  ipHash: string | null
  now?: Date
}): Promise<boolean> {
  const since = (ms: number) => ({ gte: new Date(now.getTime() - ms) })
  const [userMinute, userHour, ipHour] = await Promise.all([
    userId ? db.authRequest.count({ where: { userId, kind, createdAt: since(MIN) } }) : 0,
    userId ? db.authRequest.count({ where: { userId, kind, createdAt: since(HOUR) } }) : 0,
    ipHash ? db.authRequest.count({ where: { ipHash, createdAt: since(HOUR) } }) : 0,
  ])
  await db.authRequest.create({ data: { kind, userId, ipHash, createdAt: now } })
  return userMinute < USER_LIMIT_PER_MINUTE && userHour < USER_LIMIT_PER_HOUR && ipHour < IP_LIMIT_PER_HOUR
}

/**
 * Makes a new token for one purpose and cancels any earlier one of the same
 * kind that has not been used. Returns the raw token, which exists only here
 * and in the email: it is never stored.
 */
export async function issueToken({
  userId, purpose, email, now = new Date(),
}: {
  userId: string
  purpose: TokenPurpose
  email: string
  now?: Date
}): Promise<{ id: string; raw: string }> {
  const raw = crypto.randomBytes(32).toString('base64url')
  await db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } })
  const token = await db.authToken.create({
    data: { userId, purpose, email, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]), createdAt: now },
  })
  return { id: token.id, raw }
}

/**
 * Uses a token up. Returns its row, or null for anything that is not a
 * token of one of these kinds, unused and in time. The claim is one
 * conditional update, so two requests with the same token cannot both win.
 */
export async function consumeToken(raw: unknown, purposes: TokenPurpose[], now: Date = new Date()) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null
  const tokenHash = hashToken(raw)
  const claimed = await db.authToken.updateMany({
    where: { tokenHash, purpose: { in: purposes }, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (claimed.count !== 1) return null
  return db.authToken.findUnique({ where: { tokenHash } })
}

// ── Confirming the email on an account ─────────────────────────────────────

/**
 * Sends the link that confirms the address on an account, if it has one that
 * still needs confirming and the limits allow. Says nothing either way.
 * `limited` is false only for the email sent at sign-up itself.
 */
export async function requestVerification(
  user: { id: string; email: string | null; emailVerifiedAt: Date | null },
  ipHash: string | null,
  { limited = true, now = new Date() }: { limited?: boolean; now?: Date } = {},
): Promise<void> {
  const allowed = await allowRequest({ kind: 'VERIFY_EMAIL', userId: user.id, ipHash, now })
  if (!user.email || user.emailVerifiedAt) return
  if (limited && !allowed) return
  const token = await issueToken({ userId: user.id, purpose: 'VERIFY_EMAIL', email: user.email, now })
  notify('account.verify_email', { tokenId: token.id, token: token.raw })
}

// ── Changing the email on an account ───────────────────────────────────────

export type EmailChangeResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Starts a change of email. The link goes to the NEW address; the current
 * address is told that a change was asked for. Nothing on the account changes
 * until the link is followed. The answer is the same whether or not the new
 * address is free, so it cannot be used to find out who has an account.
 */
export async function requestEmailChange(
  user: { id: string; email: string | null },
  rawEmail: unknown,
  ipHash: string | null,
  now: Date = new Date(),
): Promise<EmailChangeResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return { ok: false, status: 400, error: 'Enter a valid email address (e.g. ama@example.com)' }

  const allowed = await allowRequest({ kind: 'CHANGE_EMAIL', userId: user.id, ipHash, now })
  if (email === user.email) return { ok: true }
  if (!allowed) return { ok: true }
  const taken = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (taken) return { ok: true }

  const token = await issueToken({ userId: user.id, purpose: 'CHANGE_EMAIL', email, now })
  notify('account.confirm_new_email', { tokenId: token.id, token: token.raw })
  // The address in force is told, so a change someone else started is noticed
  if (user.email) notify('account.email_change_requested', { tokenId: token.id, oldEmail: user.email })
  return { ok: true }
}

export type ConfirmResult =
  | { ok: false }
  | { ok: true; kind: 'VERIFIED' | 'CHANGED'; userId: string }

/**
 * Follows a confirmation link: marks the account's email confirmed, or makes
 * the new address the account's email. Fails the same way for every reason.
 */
export async function confirmEmail(raw: unknown, now: Date = new Date()): Promise<ConfirmResult> {
  const token = await consumeToken(raw, ['VERIFY_EMAIL', 'CHANGE_EMAIL'], now)
  if (!token) return { ok: false }
  const user = await db.user.findUnique({ where: { id: token.userId }, select: { id: true, email: true } })
  if (!user) return { ok: false }

  if (token.purpose === 'VERIFY_EMAIL') {
    // Only the address the link was sent to: if the email has changed since, this link proves nothing about the new one
    const done = await db.user.updateMany({ where: { id: user.id, email: token.email }, data: { emailVerifiedAt: now } })
    return done.count === 1 ? { ok: true, kind: 'VERIFIED', userId: user.id } : { ok: false }
  }

  try {
    // The unique index on email is the last word: an address taken by someone
    // else since the link was sent is refused here
    await db.user.update({ where: { id: user.id }, data: { email: token.email, emailVerifiedAt: now } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { ok: false }
    throw error
  }
  // The old address hears that it is no longer the account's email
  if (user.email && user.email !== token.email) notify('account.email_changed', { tokenId: token.id, oldEmail: user.email })
  return { ok: true, kind: 'CHANGED', userId: user.id }
}

// ── Forgotten passwords ────────────────────────────────────────────────────

/**
 * Sends a reset link if the address has an account and the limits allow.
 * Says nothing either way: the caller gives the same answer every time.
 */
export async function requestPasswordReset(rawEmail: unknown, ipHash: string | null, now: Date = new Date()): Promise<void> {
  const email = normalizeEmail(rawEmail)
  const user = email ? await db.user.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true } }) : null
  const allowed = await allowRequest({ kind: 'RESET_PASSWORD', userId: user?.id ?? null, ipHash, now })
  if (!user?.email || !allowed) return
  const token = await issueToken({ userId: user.id, purpose: 'RESET_PASSWORD', email: user.email, now })
  notify('account.password_reset', { tokenId: token.id, token: token.raw })
}

export type ResetResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Sets a new password from a reset link and signs the account out everywhere:
 * every session is deleted, so whoever knew the old password is out.
 */
export async function resetPassword(raw: unknown, password: unknown, now: Date = new Date()): Promise<ResetResult> {
  // Checked before the link is used, so a too-short password does not waste it
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, status: 400, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }
  }
  const token = await consumeToken(raw, ['RESET_PASSWORD'], now)
  if (!token) return { ok: false, status: 400, error: BAD_LINK }
  const user = await db.user.findUnique({ where: { id: token.userId }, select: { id: true, email: true, emailVerifiedAt: true } })
  if (!user) return { ok: false, status: 400, error: BAD_LINK }

  const passwordHash = await bcrypt.hash(password, 12)
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Following a link sent to the address also proves the address is theirs
        ...(!user.emailVerifiedAt && user.email === token.email ? { emailVerifiedAt: now } : {}),
      },
    }),
    db.session.deleteMany({ where: { userId: user.id } }),
    // Any other link still out for this account dies with the old password
    db.authToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
  ])
  notify('account.password_changed', { tokenId: token.id })
  return { ok: true }
}
