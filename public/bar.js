/*
 * The unread-message badge on the phone's bottom bar (src/components/layout/BottomBar.tsx). Loaded only at
 * phone widths, by the one-line check in the page's head (src/app/layout.tsx), so a desktop never downloads
 * it. Plain script, not part of the app's bundle. It asks GET /api/messages/unread when a page with the bar
 * opens, every 60 seconds while the page is in view, and when the page changes; it writes the count only
 * into the badge's own empty slot, and only once React has taken the page over (writing before that would
 * make the server's copy and the browser's differ).
 *
 * A tap on a tab (the real-phone finding of 2026-11-10: nothing happened for a second or two, so people tapped
 * again). The tapped tab is marked at once (data-going, globals.css) and the page area shows that tab's
 * placeholder, drawn in the shape of the page on its way (.tab-loading, over the old page, under the header and
 * the bar), until the new address is in place, when the new page's own bar has the real state. A second tap on
 * the tab being opened does nothing. Only once React has the page: before that a tap is an ordinary link.
 */
(function () {
  if (window.__fieBar) return
  window.__fieBar = true
  var count = 0
  var path = location.pathname

  function slots() { return document.querySelectorAll('[data-bottom-bar] [data-unread-slot]') }
  function running(el) { return Object.keys(el).some(function (k) { return k.indexOf('__reactFiber') === 0 }) }

  function paint() {
    slots().forEach(function (slot) {
      if (!running(slot)) return
      var shown = count > 0 ? (count > 9 ? '9+' : String(count)) : ''
      if (slot.getAttribute('data-count') === shown) return
      slot.setAttribute('data-count', shown)
      slot.textContent = ''
      if (!shown) { slot.hidden = true; return }
      var number = document.createElement('span')
      number.setAttribute('aria-hidden', 'true')
      number.textContent = shown
      var words = document.createElement('span')
      words.className = 'bottom-bar-sr'
      words.textContent = count + (count === 1 ? ' unread message' : ' unread messages')
      slot.appendChild(number)
      slot.appendChild(words)
      slot.hidden = false
    })
  }

  function ask() {
    if (document.hidden || slots().length === 0) return
    fetch('/api/messages/unread', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (answer) { if (answer && typeof answer.count === 'number') { count = answer.count; paint() } })
      .catch(function () {})
  }

  // ── A tap on a tab ───────────────────────────────────────────────────────────────────────────────────────
  // Each placeholder is the phone layout of its page as it first draws (the same classes): Trips' compact header,
  // row of figures and two bookings; the Wishlist's title and two cards; the inbox; the Profile's lists. Words
  // that are the same for everyone are written; anything that is not (a name, a count) is a grey block.
  function ph(cls, style) { return '<span class="ph-block ' + (cls || '') + '"' + (style ? ' style="' + style + '"' : '') + '></span>' }
  function repeat(n, html) { var out = ''; for (var i = 0; i < n; i++) out += html; return out }
  var figures = ['Bookings', 'Saved', 'Reviews', 'Trust'].map(function (label, i) {
    return '<div class="flex flex-col items-center py-2.5 min-w-0"' + (i ? ' style="border-left:1px solid var(--color-border)"' : '') + '><dd class="text-base font-semibold" style="color:var(--color-text-primary)">-</dd><dt class="text-xs whitespace-nowrap" style="color:var(--color-text-muted)">' + label + '</dt></div>'
  }).join('')
  var rows = function (n) { return '<ul class="account-list">' + repeat(n, '<li><span class="account-row">' + ph('', 'width:20px;height:20px') + ph('', 'width:9rem;height:1.25rem') + '</span></li>') + '</ul>' }
  var section = function (title, n) { return '<section class="mt-8"><h2 class="text-xs font-semibold uppercase tracking-wide mb-2" style="color:var(--color-text-muted)">' + title + '</h2>' + rows(n) + '</section>' }
  var card = '<li class="explore-card"><span class="explore-card-photo"></span><span class="explore-card-body"><span class="explore-card-top">' + ph('', 'height:16px;width:60%') + '</span>' +
    repeat(3, '<span class="explore-card-line">' + ph('', 'height:14px;width:45%;margin-top:3px') + '</span>') + '</span></li>'
  var exploreRow = '<section class="explore-row"><div class="explore-row-head"><h2>' + ph('', 'height:1.3em;width:10rem') + '</h2></div><ul class="explore-strip">' + repeat(2, card) + '</ul></section>'
  var PLACEHOLDERS = {
    // Explore's own classes, and only grey shapes (its words live in src/): with .explore-phone in the page the header
    // steps aside at once (globals.css), as it does on Explore, so nothing moves when Explore arrives
    explore: '<div class="explore-phone"><div class="explore-top"><span class="explore-pill">' + ph('', 'height:18px;width:18px;border-radius:999px') + ph('', 'height:1rem;width:6rem') + '</span>' +
      '<ul class="explore-chips">' + repeat(4, '<li><span class="explore-chip" style="width:8.5rem">' + ph('', 'height:14px;width:100%') + '</span></li>') + '</ul></div>' +
      repeat(2, exploreRow) + '</div>',
    trips: '<div class="max-w-6xl mx-auto px-4 py-8 max-md:flex max-md:flex-col max-md:pt-4 max-md:pb-6">' +
      '<div class="flex items-center gap-3 mb-3">' + ph('w-11 h-11 flex-shrink-0', 'border-radius:999px') +
        '<div class="min-w-0 flex-1"><h1>' + ph('', 'height:1.2em;width:8rem') + '</h1>' + ph('mt-1', 'height:44px;width:15rem;max-width:100%;border-radius:999px') + '</div></div>' +
      '<dl class="grid grid-cols-4 mb-5 rounded-2xl" style="background-color:var(--color-bg-card);border:1px solid var(--color-border)">' + figures + '</dl>' +
      '<div class="mb-8"><h2 class="text-xl font-bold mb-5" style="color:var(--color-text-primary)">Your Bookings</h2><div class="space-y-4">' +
        repeat(2, '<div class="soft-panel p-4 flex gap-4">' + ph('w-16 h-16 flex-shrink-0', 'border-radius:12px') + '<div class="flex-1 space-y-2">' + ph('h-4 w-2/3') + ph('h-3 w-1/3') + ph('h-3 w-1/2') + '</div></div>') +
      '</div></div></div>',
    wishlists: '<div class="phone-title"><h1>Your Wishlist</h1><p>&nbsp;</p></div>' +
      '<div class="max-w-5xl mx-auto px-4 py-8 max-md:pt-4"><div class="grid grid-cols-1 gap-5">' +
        repeat(2, '<div class="bg-white rounded-2xl overflow-hidden">' + ph('h-48', 'border-radius:0') + '<div class="p-4">' + ph('h-5 w-3/4 mb-1') + ph('h-4 w-1/2 mb-3') + ph('h-9 w-1/3') + '</div></div>') +
      '</div></div>',
    messages: '<div class="phone-title"><h1>Messages</h1><p>' + ph('', 'height:1.3125rem;width:10rem') + '</p></div>' +
      '<div class="max-w-6xl mx-auto px-4 py-6 max-md:pt-4"><div class="soft-panel overflow-hidden" style="height:600px">' +
        '<div class="p-4 border-b border-stone-100">' + ph('h-11 w-full rounded-xl') + '</div>' +
        repeat(4, '<div class="p-4 flex items-start gap-3 border-b border-stone-50">' + ph('w-10 h-10 flex-shrink-0', 'border-radius:999px') + '<span class="flex-1 min-w-0">' + ph('h-4 w-1/2 mb-1.5') + ph('h-3 w-3/4 mb-1.5') + ph('h-3 w-2/3') + '</span></div>') +
      '</div></div>',
    profile: '<div class="max-w-xl mx-auto px-4 py-8"><h1 class="text-2xl font-bold" style="color:var(--color-text-primary)">Profile</h1>' +
      '<p class="text-sm mt-1">' + ph('', 'height:1.25rem;width:14rem;max-width:100%') + '</p>' +
      section('Your account', 4) + section('Hosting', 1) + section('Help', 5) + '</div>',
  }
  var going = null
  var giveUp = 0

  function settle() {
    going = null
    clearTimeout(giveUp)
    document.documentElement.removeAttribute('data-tab-going')
    document.querySelectorAll('[data-bottom-bar] [data-going]').forEach(function (a) { a.removeAttribute('data-going') })
    var shown = document.getElementById('tab-loading')
    if (shown) shown.remove()
  }

  // Capture, on window: before React's own handler, so a second tap can be stopped before it starts a second move
  window.addEventListener('click', function (e) {
    var link = e.target instanceof Element ? e.target.closest('[data-bottom-bar] a[data-tab]') : null
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !running(link)) return
    var tab = link.getAttribute('data-tab')
    if (going === tab) { e.preventDefault(); e.stopPropagation(); return }
    // The page you are on: the app does what it always did
    if (link.getAttribute('aria-current') === 'page') { settle(); return }
    settle()
    going = tab
    link.setAttribute('data-going', '')
    document.documentElement.setAttribute('data-tab-going', tab)
    if (PLACEHOLDERS[tab]) {
      var cover = document.createElement('div')
      cover.id = 'tab-loading'
      cover.className = 'tab-loading'
      cover.setAttribute('aria-hidden', 'true')
      cover.innerHTML = PLACEHOLDERS[tab]
      document.body.appendChild(cover)
    }
    // A move that never ends (the app falls back to loading the page whole, which replaces all of this anyway)
    giveUp = setTimeout(settle, 15000)
  }, true)
  window.addEventListener('popstate', settle)
  window.addEventListener('pageshow', function (e) { if (e.persisted) settle() })

  // A new page (the app moves between pages without reloading): the tap is over; paint what is known, then ask again
  new MutationObserver(function () {
    if (location.pathname !== path) { path = location.pathname; settle(); ask() }
    paint()
  }).observe(document.body, { childList: true, subtree: true })
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ask() })
  setInterval(ask, 60000)
  ask()
  // React takes the page over a moment after this runs: paint once it has
  var tries = 0
  var wait = setInterval(function () { paint(); if (++tries > 40) clearInterval(wait) }, 250)
})()
