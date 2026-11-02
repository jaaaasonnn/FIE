/*
 * The unread-message badge on the phone's bottom bar (src/components/layout/BottomBar.tsx). Loaded only at
 * phone widths, by the one-line check in the page's head (src/app/layout.tsx), so a desktop never downloads
 * it. Plain script, not part of the app's bundle. It asks GET /api/messages/unread when a page with the bar
 * opens, every 60 seconds while the page is in view, and when the page changes; it writes the count only
 * into the badge's own empty slot, and only once React has taken the page over (writing before that would
 * make the server's copy and the browser's differ).
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

  // A new page (the app moves between pages without reloading): paint what is known, then ask again
  new MutationObserver(function () {
    if (location.pathname !== path) { path = location.pathname; ask() }
    paint()
  }).observe(document.body, { childList: true, subtree: true })
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ask() })
  setInterval(ask, 60000)
  ask()
  // React takes the page over a moment after this runs: paint once it has
  var tries = 0
  var wait = setInterval(function () { paint(); if (++tries > 40) clearInterval(wait) }, 250)
})()
