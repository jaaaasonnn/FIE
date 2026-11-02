import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// App shell, stage 1 polish: at phone widths (320, 360, 390, 430 px) on the main pages, signed out and signed in:
//  - no text runs outside its own box (an element whose content is wider than it, scrollWidth > clientWidth),
//    and nothing makes the page scroll sideways;
//  - pills, chips and badges stay on one line (never wrap mid-label);
//  - no text smaller than 12 px, except the bottom bar's tab labels;
//  - buttons, pills, fields and the bar's tabs are at least 44 px tall (a link inside a sentence is not a
//    target of its own).
// Groups that scroll sideways on purpose (overflow-x auto) are allowed to be wider than their box; what is in
// them is still checked. @core: it sets its own widths, so it runs in the Chromium, iPhone and Android set-ups.

const WIDTHS = [320, 360, 390, 430]
const onlyIn = () => test.skip(!['chromium', 'iphone', 'android'].includes(test.info().project.name), 'widths are set by the test; three set-ups are enough')

type Problem = string
async function audit(page: Page, where: string): Promise<Problem[]> {
  return page.evaluate((where) => {
    const out: string[] = []
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`
    const visible = (el: Element) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // Inside a group that scrolls sideways on purpose, or a hidden part of the page
    const scrollsOnPurpose = (el: Element) => { const s = getComputedStyle(el); return s.overflowX === 'auto' || s.overflowX === 'scroll' }
    const inBar = (el: Element) => !!el.closest('[data-bottom-bar]')
    // A pill: a small inline element with rounded ends (a chip, a badge, a pill-shaped link or button)
    const pill = (el: Element) => typeof el.className === 'string' && /\b(rounded-full|badge|chip|pill)\b/.test(el.className)
      && (el.textContent ?? '').trim().length > 0 && (el.textContent ?? '').trim().length <= 40 && /inline|flex/.test(getComputedStyle(el).display) && el.getBoundingClientRect().height < 80
    // How many lines the element's words take (its text alone: an icon beside the words is not a line)
    const lines = (el: Element) => {
      const tops: number[] = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? '').trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) if (r.width > 1 && r.height > 1) tops.push(r.top)
      }
      const size = parseFloat(getComputedStyle(el).fontSize) || 14
      return new Set(tops.map((t) => Math.round(t / (size * 0.8)))).size
    }

    // The page itself: no sideways scrolling
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      // Name what reaches past the right edge (the outermost such element)
      const wide = Array.from(document.querySelectorAll('body *')).filter((e) => visible(e) && e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('[style*="overflow"], .overflow-x-auto, .overflow-hidden'))
      const outer = wide.filter((e) => !wide.some((o) => o !== e && o.contains(e))).slice(0, 3).map((e) => `${name(e)} reaching ${Math.round(e.getBoundingClientRect().right)}: ${e.outerHTML.replace(/\s+/g, ' ').slice(0, 260)}`)
      out.push(`${where}: the page scrolls sideways (${document.documentElement.scrollWidth} px wide at ${window.innerWidth}): ${outer.join('; ')}`)
    }

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      // Text for screen readers only is clipped to nothing on purpose
      if (el.closest('.sr-only, .bottom-bar-sr')) continue
      { const r = el.getBoundingClientRect(); if (r.width <= 1 && r.height <= 1) continue }
      if (!visible(el) || el.closest('svg') || ['SCRIPT', 'STYLE', 'svg', 'IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'IFRAME', 'BR'].includes(el.tagName)) continue
      // Map pieces are drawn by the map library and checked by the map tests
      if (el.closest('.maplibregl-map, [data-map-unavailable]')) continue
      const s = getComputedStyle(el)
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0)
      // 1. Text outside its box
      // (text cut with an ellipsis is cut on purpose, where a box has a fixed width)
      // (any element: a row whose pill runs past the card's edge is caught at the card)
      if (!scrollsOnPurpose(el) && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        out.push(`${where}: ${hasText ? 'text' : 'something'} outside its box: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`)
      }
      // 2. Pills on one line
      if (pill(el) && lines(el) > 1) out.push(`${where}: a pill wraps: ${name(el)}`)
      // ...and stays inside the box it sits in (unless that box scrolls sideways on purpose)
      if (pill(el) && el.parentElement && !scrollsOnPurpose(el.parentElement)) {
        const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect()
        if (r.right > p.right + 1 || r.left < p.left - 1) out.push(`${where}: a pill runs out of its box: ${name(el)} (${Math.round(r.left)}-${Math.round(r.right)} in ${Math.round(p.left)}-${Math.round(p.right)})`)
      }
      // 3. Text size
      if (hasText && !inBar(el) && parseFloat(s.fontSize) < 12 && !el.closest('.sr-only, .bottom-bar-sr')) out.push(`${where}: text under 12 px (${s.fontSize}): ${name(el)}`)
      // 4. Targets
      const target = el.tagName === 'BUTTON' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden', 'file'].includes((el as HTMLInputElement).type)) || el.getAttribute('role') === 'button' || (el.tagName === 'A' && (pill(el) || el.classList.contains('bottom-bar-tab') || el.classList.contains('account-row')))
      if (target && !el.closest('footer, .react-datepicker') && el.getBoundingClientRect().height < 44 - 0.5) out.push(`${where}: target under 44 px (${Math.round(el.getBoundingClientRect().height)}): ${name(el)}`)
    }
    return out
  }, where)
}

async function pages(world: import('../../lib/world').World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome, the key is with the caretaker', bookingId })).status).toBe(201)
  return { guest, listingId: home.id }
}

test.describe('phone layout: everything fits (app shell, stage 1 polish)', () => {
  test('signed out: no text outside its box, pills on one line, no sideways scrolling, readable sizes, 44 px targets @core', async ({ page, world }) => {
    onlyIn()
    test.setTimeout(180_000)
    const { listingId } = await pages(world)
    const found: Problem[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const url of ['/', '/search?q=Accra', `/listings/${listingId}`, '/how-it-works']) {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        found.push(...await audit(page, `${width}px ${url}`))
      }
    }
    expect(found).toEqual([])
  })

  test('signed in: no text outside its box, pills on one line, no sideways scrolling, readable sizes, 44 px targets @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const { guest, listingId } = await pages(world)
    await signIn(guest)
    const found: Problem[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const url of ['/', '/search?q=Accra', `/listings/${listingId}`, '/dashboard/guest', '/dashboard/guest/wishlist', '/dashboard/guest/messages', '/account', '/how-it-works']) {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        found.push(...await audit(page, `${width}px ${url}`))
      }
    }
    expect(found).toEqual([])
  })
})
