import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The fee structure: guests pay no service fee, and FieGH takes a 10%
// commission from the host's payout. Pure rules and rendered copy only: no
// database and no network.

// The accordion keeps closed answers out of the page until they are opened;
// here every question and answer is laid out so the wording can be read
vi.mock('@/components/faq/FaqAccordion', () => ({
  FaqAccordion: ({ questions }: { questions: { q: string; a: string }[] }) =>
    createElement('dl', null, questions.flatMap(({ q, a }) => [createElement('dt', { key: q }, q), createElement('dd', { key: `${q}-a` }, a)])),
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }))

import { PLATFORM_COMMISSION, SERVICE_FEE_RATE, calculateFees } from '@/lib/utils'
import {
  COMMISSION_PERCENT, GUEST_FEE_CHARGED, GUEST_FEE_LINE, HOST_COMMISSION_LINE, HOST_KEEPS_PERCENT, percent, serviceFeeRefundRule,
} from '@/lib/fees'
import { commonRuleLines, quoteRefund } from '@/lib/cancellationPolicy'
import { previewCancellation, type CancelBooking } from '@/lib/cancellation'
import { decisionEffect, hostCommission, hostShare } from '@/lib/disputes'
import { hostPayoutAmount } from '@/lib/cronRuns'
import { EVENT_NAMES, SAMPLE_FACTS, TEMPLATES, emailFooter, emailText, type Template } from '@/lib/messaging/templates'
import { PriceBreakdown } from '@/components/booking/PriceBreakdown'
import { CancellationPolicy } from '@/components/booking/CancellationPolicy'
import TermsPage from '@/app/terms/page'
import HowItWorksPage from '@/app/how-it-works/page'
import FaqPage from '@/app/faq/page'

const NOW = new Date('2027-03-01T10:00:00Z')
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ─── The two rates ──────────────────────────────────────────────────────────

describe('the rates', () => {
  it('charge guests nothing and take 10% from the host', () => {
    expect(SERVICE_FEE_RATE).toBe(0)
    expect(PLATFORM_COMMISSION).toBe(0.1)
    expect(GUEST_FEE_CHARGED).toBe(false)
  })

  it('make a new booking cost the rent and nothing on top', () => {
    expect(calculateFees(400)).toEqual({ basePrice: 400, serviceFee: 0, total: 400, hostPayout: 360 })
    expect(calculateFees(99.99)).toMatchObject({ serviceFee: 0, total: 99.99 })
  })

  it('write themselves as percentages', () => {
    expect(percent(0)).toBe('0%')
    expect(percent(0.1)).toBe('10%')
    expect(percent(0.9)).toBe('90%')
    expect(percent(0.125)).toBe('12.5%')
    expect(COMMISSION_PERCENT).toBe('10%')
    expect(HOST_KEEPS_PERCENT).toBe('90%')
  })

  it('say it in one plain sentence each', () => {
    expect(GUEST_FEE_LINE).toBe('Guests pay no service fee.')
    expect(HOST_COMMISSION_LINE).toBe('Hosts keep 90% of the rent: FieGH takes a 10% commission from each payout.')
    expect(serviceFeeRefundRule('stay price')).toBeNull()
    expect(serviceFeeRefundRule('rent', true)).toBe('The service fee is refunded only when the whole rent is refunded.')
  })
})

// ─── The host's share ───────────────────────────────────────────────────────

describe('what a host is paid', () => {
  it('is 90% of the stay price', () => {
    expect(hostShare(400)).toBeCloseTo(360)
    expect(hostShare(100)).toBeCloseTo(90)
    expect(hostPayoutAmount(240)).toBeCloseTo(216)
    expect(hostPayoutAmount(1333.33)).toBeCloseTo(1199.997)
  })

  it('is 90% of what is left after part of the stay price is refunded', () => {
    expect(hostShare(400, 150)).toBeCloseTo(225)
    expect(hostPayoutAmount(400, 400)).toBe(0)
    expect(hostShare(400, 999)).toBe(0)
  })

  it('and the commission add up to the stay price, with nothing for a guest fee', () => {
    for (const [subtotal, refunded] of [[400, 0], [400, 150], [1333.33, 0], [80, 80]]) {
      expect(hostShare(subtotal, refunded) + hostCommission(subtotal, refunded)).toBeCloseTo(subtotal - refunded)
    }
    expect(hostCommission(400)).toBeCloseTo(40)
    expect(hostCommission(400, 150)).toBeCloseTo(25)
  })
})

// ─── Refunds and cancelling ─────────────────────────────────────────────────

describe('refunds with no service fee', () => {
  // Four nights at $100 and a $50 deposit: $450 paid, nothing for a fee
  const paid = { rentalMode: 'SHORT_STAY', policy: 'MODERATE', subtotal: 400, serviceFee: 0, damageDeposit: 50, pricePerUnit: 100, paid: 450 }

  it('give back the stay price and the deposit in full', () => {
    expect(quoteRefund({ ...paid, by: 'GUEST', daysBefore: 10 })).toEqual({
      policy: 'MODERATE', percent: 100, stayRefund: 400, serviceFeeRefund: 0, depositRefund: 50, total: 450, kept: 0,
    })
  })

  it('give back half the stay price and the whole deposit', () => {
    expect(quoteRefund({ ...paid, by: 'GUEST', daysBefore: 3 })).toEqual({
      policy: 'MODERATE', percent: 50, stayRefund: 200, serviceFeeRefund: 0, depositRefund: 50, total: 250, kept: 200,
    })
  })

  it('give back only the deposit when the stay price is no longer refundable', () => {
    expect(quoteRefund({ ...paid, policy: 'STRICT', by: 'GUEST', daysBefore: 2 })).toMatchObject({ stayRefund: 0, serviceFeeRefund: 0, depositRefund: 50, total: 50, kept: 400 })
  })

  it('give back everything when the host cancels', () => {
    expect(quoteRefund({ ...paid, policy: 'STRICT', by: 'HOST', daysBefore: 0 })).toMatchObject({ stayRefund: 400, serviceFeeRefund: 0, depositRefund: 50, total: 450, kept: 0 })
  })

  it('still cap what is kept at one month of rent, with no fee in the sum', () => {
    const year = { rentalMode: 'PERMANENT', policy: 'STRICT', subtotal: 12_000, serviceFee: 0, damageDeposit: 500, pricePerUnit: 12_000, paid: 12_500 }
    expect(quoteRefund({ ...year, by: 'GUEST', daysBefore: 5 })).toMatchObject({ stayRefund: 11_000, serviceFeeRefund: 0, depositRefund: 500, total: 11_500, kept: 1_000 })
  })

  it('leave a booking that was charged a fee exactly as it was', () => {
    const old = { ...paid, serviceFee: 48, paid: 498 }
    expect(quoteRefund({ ...old, by: 'GUEST', daysBefore: 10 })).toMatchObject({ stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, total: 498, kept: 0 })
    expect(quoteRefund({ ...old, by: 'GUEST', daysBefore: 3 })).toMatchObject({ stayRefund: 200, serviceFeeRefund: 0, depositRefund: 50, total: 250, kept: 248 })
    expect(quoteRefund({ ...old, by: 'HOST', daysBefore: 3 })).toMatchObject({ serviceFeeRefund: 48, total: 498 })
  })
})

describe('the cancellation preview', () => {
  const booking = (serviceFee: number): CancelBooking => ({
    status: 'CONFIRMED', paymentStatus: 'PAID', rentalMode: 'SHORT_STAY', checkIn: new Date('2027-03-11T12:00:00Z'),
    subtotal: 400, serviceFee, damageDeposit: 50, pricePerUnit: 100, cancellationPolicy: 'MODERATE', listing: { cancellationPolicy: 'MODERATE' },
  })
  const preview = (serviceFee: number) => previewCancellation({
    booking: booking(serviceFee), payment: { id: 'payment_1', amount: 450 + serviceFee, amountPesewas: (450 + serviceFee) * 1550 },
    hasPayout: false, by: 'GUEST', now: NOW,
  })

  it('shows the stay price and deposit, and says nothing about a fee, on a booking with none', () => {
    const p = preview(0)
    expect(p).toMatchObject({ canCancel: true, paidAmount: 450, serviceFee: 0, quote: { stayRefund: 400, serviceFeeRefund: 0, depositRefund: 50, total: 450, kept: 0 }, refundPesewas: 697_500 })
    expect(p.canCancel && p.rules.join(' ')).not.toMatch(/service fee/i)
  })

  it('still shows and explains the fee on a booking that was charged one', () => {
    const p = preview(48)
    expect(p).toMatchObject({ canCancel: true, paidAmount: 498, serviceFee: 48, quote: { serviceFeeRefund: 48, total: 498 } })
    expect(p.canCancel && p.rules).toContain('The service fee is refunded only when the whole stay price is refunded.')
  })

  it('states the fee rule on a listing only if new bookings are charged a fee', () => {
    expect(commonRuleLines('SHORT_STAY').join(' ')).not.toMatch(/service fee/i)
    expect(commonRuleLines('TEMP_STAY').join(' ')).not.toMatch(/service fee/i)
  })
})

// ─── Dispute decisions ──────────────────────────────────────────────────────

describe('a partial refund after a dispute', () => {
  const effect = (serviceFee: number, over: Record<string, unknown> = {}) => decisionEffect({
    role: 'GUEST', outcome: 'PARTIAL_REFUND', amount: 150,
    booking: { rentalMode: 'SHORT_STAY', subtotal: 400, serviceFee, damageDeposit: 50 },
    payment: { id: 'payment_1', amount: 450 + serviceFee, amountPesewas: (450 + serviceFee) * 1550 },
    existingRefund: null, payout: null, ...over,
  })

  it('pays the host 90% of what is left of the stay price', () => {
    const e = effect(0)
    expect(e).toMatchObject({ ok: true, hostPayout: 225, refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150, serviceFeeRefund: 0, depositRefund: 0, amount: 150 } })
    expect(e.ok && e.summary.join(' ')).toBe('The guest is refunded $150.00 of the $400.00 stay price. The host is paid $225.00: 90% of the $250.00 left. The next payout run sends it.')
  })

  it('mentions a service fee only on a booking that was charged one', () => {
    expect(JSON.stringify(effect(0))).not.toMatch(/service fee/i)
    const old = effect(48)
    expect(old.ok && old.summary[0]).toBe('The guest is refunded $150.00 of the $400.00 stay price. The service fee is kept.')
    expect(old).toMatchObject({ hostPayout: 225 })
  })

  it('tells the admin what to recover when the host was already paid at the full share', () => {
    const e = effect(0, { payout: { status: 'COMPLETED', amount: 360 } })
    expect(e.ok && e.manual).toEqual(['The host has already been sent $360.00 and is now owed $225.00. Recover $135.00 by hand.'])
  })

  it('refunds everything paid on a full refund: the stay price and the deposit', () => {
    const e = effect(0, { outcome: 'FULL_REFUND', amount: undefined })
    expect(e).toMatchObject({ ok: true, hostPayout: 0, refund: { reason: 'DISPUTE_FULL', stayRefund: 400, serviceFeeRefund: 0, depositRefund: 50, amount: 450 } })
  })

  it('lifts the hold at the full 90% when the report is rejected', () => {
    const e = effect(0, { outcome: 'REJECTED', amount: undefined })
    expect(e.ok && e.summary[1]).toBe('The hold on the payout is lifted. The host is paid $360.00 by the next payout run.')
  })
})

// ─── What people read ───────────────────────────────────────────────────────

describe('the price breakdown', () => {
  const props = { rentalMode: 'SHORT_STAY', pricePerUnit: 100, units: 4, subtotal: 400, deposit: 50, ghsRate: 15.5 }

  it('has no service fee line when there is no fee: the total is the rent plus the deposit', () => {
    const html = text(renderToStaticMarkup(createElement(PriceBreakdown, { ...props, serviceFee: 0, total: 450 })))
    expect(html).not.toMatch(/service fee/i)
    expect(html).not.toContain('Stay total')
    expect(html).toContain('$100.00 × 4 nights $400.00')
    expect(html).toContain('Refundable deposit $50.00')
    expect(html).toContain('Total due now $450.00')
  })

  it('has no deposit line either when there is no deposit: the total is the rent', () => {
    const html = text(renderToStaticMarkup(createElement(PriceBreakdown, { ...props, deposit: 0, serviceFee: 0, total: 400 })))
    expect(html).not.toMatch(/service fee|deposit/i)
    expect(html).toContain('Total due now $400.00')
  })

  it('still shows the fee a booking was really charged', () => {
    const html = text(renderToStaticMarkup(createElement(PriceBreakdown, { ...props, serviceFee: 48, total: 498 })))
    expect(html).toContain('Service fee $48.00')
    expect(html).toContain('Stay total $448.00')
    expect(html).toContain('Total due now $498.00')
  })
})

describe('the cancellation policy shown to guests', () => {
  const render = (serviceFee?: number) => text(renderToStaticMarkup(createElement(CancellationPolicy, { policy: 'MODERATE', rentalMode: 'SHORT_STAY', serviceFee })))

  it('says nothing about a service fee on a listing or on a booking with none', () => {
    expect(render()).not.toMatch(/service fee/i)
    expect(render(0)).not.toMatch(/service fee/i)
    expect(render()).toContain('The damage deposit is always refunded in full if you cancel before check-in.')
  })

  it('keeps the fee rule on a booking that was charged one', () => {
    expect(render(48)).toContain('The service fee is refunded only when the whole stay price is refunded.')
  })
})

describe('messages', () => {
  it.each(EVENT_NAMES)('%s mentions no service fee and states no percentage', (event) => {
    const template: Template = TEMPLATES[event]
    for (const piece of template.render(SAMPLE_FACTS)) {
      const all = [
        piece.email ? emailText(piece.email, SAMPLE_FACTS.appUrl, emailFooter(SAMPLE_FACTS, template.optional === true)) : '',
        piece.email?.subject ?? '', piece.sms ?? '', piece.inApp?.title ?? '', piece.inApp?.body ?? '',
      ].join(' ')
      expect(all).not.toMatch(/service fee|commission/i)
      expect(all).not.toMatch(/\d ?%/)
    }
  })
})

describe('site copy', () => {
  it('states the new fees on the terms page, with no old figure left', () => {
    const page = text(renderToStaticMarkup(createElement(TermsPage)))
    expect(page).toContain('Guests pay no service fee. Hosts keep 90% of the rent: FieGH takes a 10% commission from each payout.')
    expect(page).toContain('a partial refund taken from the stay price (the host is paid their share of the rest)')
    expect(page).not.toMatch(/service fee is (kept|refunded)/i)
    expect(page).not.toMatch(/\b(8|12|92)%/)
  })

  it('states the new fees on the how it works page, with no old figure left', () => {
    const page = text(renderToStaticMarkup(createElement(HowItWorksPage)))
    expect(page).toContain('Guest service fee None')
    expect(page).toContain('Host commission 10%')
    expect(page).toContain('you keep 90% of the rent')
    expect(page).toContain('minus the 10% platform commission')
    expect(page).not.toMatch(/\b(8|12|92)%/)
  })

  it('states the new fees in the FAQ, with no old figure left', () => {
    const page = text(renderToStaticMarkup(createElement(FaqPage)))
    expect(page).toContain('FieGH takes a 10% commission from each payout, so you keep 90% of the rent. Guests pay no service fee.')
    expect(page).toContain('after the 10% commission')
    expect(page).toContain('You are refunded everything you paid: the stay price and the damage deposit.')
    expect(page).not.toMatch(/service fee is refunded/i)
    expect(page).not.toMatch(/\b(8|12|92)%/)
  })

  // Everything a rate could hide in: no percentage and no rate is written
  // down anywhere but the two constants
  const source = (dir: string): { file: string; code: string }[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return source(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [{ file: path.relative(path.resolve(__dirname, '..'), full), code: fs.readFileSync(full, 'utf8') }] : []
  })
  const files = source(path.resolve(__dirname, '..'))

  it('writes no fee percentage into any page, component or template', () => {
    expect(files.length).toBeGreaterThan(100)
    for (const { file, code } of files) {
      // Lines that mention a fee, a commission or what a host earns
      const lines = code.split('\n').filter((line) => /fee|commission|payout|earn|net\b|keeps?\b/i.test(line))
      for (const line of lines) expect(line, file).not.toMatch(/\b\d{1,2}(\.\d+)? ?%/)
    }
  })

  it('works out no amount from a rate written into the code', () => {
    for (const { file, code } of files) {
      if (file === path.join('lib', 'utils.ts')) continue
      // A price, total or subtotal multiplied by a bare decimal
      expect(code, file).not.toMatch(/(price|total|subtotal|amount|revenue)\w*(\)|\s|\?\?\s*0\)?)*\s*\*\s*\(?\s*(0?\.\d+|1\s*-\s*0?\.\d+)/i)
    }
  })

  it('counts admin revenue from stay prices, never from payments that carry deposits', () => {
    const route = fs.readFileSync(path.resolve(__dirname, '../app/api/admin/route.ts'), 'utf8')
    expect(route).not.toMatch(/payment\.aggregate/)
    expect(route).toContain('hostCommission(b.subtotal, b.refund?.stayRefund ?? 0)')
    expect(route).not.toMatch(/damageDeposit|totalPrice/)
  })

  it('works out host earnings from the stay price through hostShare', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
    expect(read('app/dashboard/host/page.tsx')).toContain('hostShare(b.subtotal)')
    expect(read('app/dashboard/host/bookings/page.tsx')).toContain('hostShare(b.subtotal)')
    expect(read('app/listings/[id]/page.tsx')).toContain('calculateFees(basePrice).serviceFee')
  })

  it('shows a service fee row only where a fee was charged', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
    expect(read('components/booking/CancelDialog.tsx')).toMatch(/preview\.serviceFee > 0 && \(\s*<div[^>]*><dt>Service fee<\/dt>/)
    expect(read('components/admin/AdminDisputes.tsx')).toMatch(/b\.serviceFee > 0 && <div><dt>Service fee<\/dt>/)
  })
})
