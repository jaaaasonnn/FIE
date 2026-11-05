/*
 * The search sheet on a phone (src/components/search/SearchSheet.tsx). Loaded only at phone widths, by the
 * one-line check in the page's head (src/lib/bottomBar.ts), so a desktop never downloads it. Plain script,
 * outside the app's bundle. Without it the sheet still works: its pill is a link to #search-sheet, CSS shows the
 * sheet as the link's target, and its form GETs /search.
 *
 * With it: the sheet opens without a jump, Back closes it (one history entry, added through the router's own
 * pushState so Next keeps the page), focus moves into it and stays there, the page behind is inert, Escape and
 * the cross close it, the guest steppers work, the date fields show the date as we write it, and fields that do
 * not apply are left out of the address. On the search page the sheet reads the search shown and changes it in
 * place (app/search/SearchClient.tsx answers 'fiegh:sheet-read' and 'fiegh:sheet-apply'). It changes the page
 * only once React has taken it over, as bar.js does, so the server's copy and the browser's never differ.
 */
(function () {
  if (window.__fieSheet) return
  window.__fieSheet = true
  var HASH = '#search-sheet'
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  var opener = null
  var inerted = []

  function sheet() { return document.querySelector('[data-search-sheet]') }
  function running(el) { return !!el && Object.keys(el).some(function (k) { return k.indexOf('__reactFiber') === 0 }) }
  function isOpen() { var s = sheet(); return !!s && s.hasAttribute('data-open') }

  // "Wed, 13 Nov", from our own names (never the browser's: src/lib/dateText.ts)
  function face(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
    if (!m) return ''
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
    return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
  }
  function paintDates(root) {
    root.querySelectorAll('.date-field').forEach(function (box) {
      var input = box.querySelector('input'), label = box.querySelector('.date-field-face')
      if (!input || !label) return
      var text = face(input.value)
      label.textContent = text || 'Add date'
      label.setAttribute('data-empty', text ? 'false' : 'true')
    })
  }

  function form() { var s = sheet(); return s && s.querySelector('[data-sheet-form]') }
  function fill(params) {
    var f = form()
    if (!f) return
    var p = new URLSearchParams(params)
    var mode = p.get('mode') || ''
    f.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === mode })
    ;['q', 'checkIn', 'checkOut', 'guests'].forEach(function (k) { if (f.elements[k]) f.elements[k].value = p.get(k) || '' })
    if (f.elements.months) f.elements.months.value = p.get('months') || '1'
    paintDates(f)
  }
  /** What the form asks for, with the fields that do not apply to the rental type left out */
  function wanted() {
    var f = form(), out = new URLSearchParams()
    if (!f) return out
    var data = new FormData(f), mode = data.get('mode') || ''
    var q = String(data.get('q') || '').trim()
    if (q) out.set('q', q)
    if (mode) out.set('mode', mode)
    var checkIn = data.get('checkIn') || ''
    if (checkIn) out.set('checkIn', checkIn)
    if (checkIn && (mode === '' || mode === 'SHORT_STAY') && data.get('checkOut')) out.set('checkOut', data.get('checkOut'))
    if (checkIn && mode === 'TEMP_STAY') out.set('months', data.get('months') || '1')
    var guests = parseInt(data.get('guests'), 10)
    if (guests > 0) out.set('guests', String(Math.min(guests, 16)))
    return out
  }

  // Everything but the sheet (and the things around it) is inert while it is open
  function setInert(on) {
    inerted.forEach(function (el) { el.inert = false })
    inerted = []
    if (!on) return
    for (var el = sheet(); el && el !== document.body; el = el.parentElement) {
      Array.prototype.forEach.call(el.parentElement.children, function (sib) {
        if (sib !== el && !sib.inert && sib.tagName !== 'SCRIPT') { sib.inert = true; inerted.push(sib) }
      })
    }
  }

  function show() {
    var s = sheet()
    if (!s || !running(s)) return false
    // On the search page, the sheet starts from the search shown
    var read = { params: null }
    document.dispatchEvent(new CustomEvent('fiegh:sheet-read', { detail: read }))
    if (read.params !== null) fill(read.params)
    else paintDates(s)
    s.setAttribute('data-open', '')
    document.documentElement.setAttribute('data-sheet-open', '')
    setInert(true)
    var panel = s.querySelector('.search-sheet-panel')
    if (panel) panel.focus({ preventScroll: true })
    return true
  }
  function hide() {
    var s = sheet()
    if (s) s.removeAttribute('data-open')
    document.documentElement.removeAttribute('data-sheet-open')
    setInert(false)
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    opener = null
  }

  var after = null
  function open(from) {
    opener = from || null
    if (!show()) return false
    if (location.hash !== HASH) history.pushState({ fieghSheet: true }, '', location.pathname + location.search + HASH)
    return true
  }
  /** Closes the sheet; `then` runs once the address no longer has the sheet in it */
  function close(then) {
    if (!isOpen()) { if (then) then(); return }
    hide()
    if (location.hash === HASH && history.state && history.state.fieghSheet) { after = then || null; history.back() }
    else {
      if (location.hash === HASH) history.replaceState(history.state, '', location.pathname + location.search)
      if (then) then()
    }
  }

  window.addEventListener('popstate', function () {
    if (location.hash === HASH) { if (!isOpen()) show() }
    else if (isOpen()) hide()
    if (location.hash !== HASH && after) { var run = after; after = null; run() }
  })

  document.addEventListener('click', function (e) {
    var t = e.target
    if (!(t instanceof Element)) return
    var pill = t.closest('[data-search-pill]')
    if (pill && sheet()) { if (open(pill)) e.preventDefault(); return }
    if (t.closest('[data-sheet-close]')) { e.preventDefault(); close(); return }
    var step = t.closest('[data-step]')
    if (step) {
      var input = form() && form().elements.guests
      if (!input) return
      var n = (parseInt(input.value, 10) || 0) + Number(step.getAttribute('data-step'))
      input.value = n < 1 ? '' : String(Math.min(n, 16))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }
    // A tap on the shaded page around the panel closes it
    if (t.matches('[data-search-sheet][data-open]')) close()
  })

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key !== 'Tab') return
    var panel = sheet().querySelector('.search-sheet-panel')
    var items = Array.prototype.filter.call(panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (el) {
      return !el.disabled && el.getClientRects().length > 0 && !(el.type === 'radio' && !el.checked && panel.querySelector('input[name="' + el.name + '"]:checked'))
    })
    if (!items.length) return
    // Every Tab is moved here, the same in every browser (Safari's Tab skips buttons and links by default, so the
    // browser's own order would leave the sheet), round from the last to the first and back
    e.preventDefault()
    var at = items.indexOf(document.activeElement)
    var next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
    items[next].focus()
  })

  document.addEventListener('change', function (e) {
    if (e.target instanceof Element && e.target.closest('[data-search-sheet] .date-field')) paintDates(sheet())
  })
  document.addEventListener('reset', function (e) {
    if (!(e.target instanceof Element) || !e.target.matches('[data-sheet-form]')) return
    e.preventDefault()
    fill('')
  })

  document.addEventListener('submit', function (e) {
    if (!(e.target instanceof Element) || !e.target.matches('[data-sheet-form]')) return
    e.preventDefault()
    var params = wanted()
    var apply = { handled: false, params: params.toString() }
    document.dispatchEvent(new CustomEvent('fiegh:sheet-apply', { detail: apply }))
    if (apply.handled) {
      // The search page changed its search in place; the address follows once the sheet has closed
      close(function () {
        var url = '/search' + (params.toString() ? '?' + params.toString() : '')
        history.replaceState(history.state, '', url)
      })
      return
    }
    // A plain script has no router: the search page is loaded whole, and it comes with its results (server-first)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    close(function () { location.assign('/search' + (params.toString() ? '?' + params.toString() : '')) })
  })

  // A page opened with #search-sheet in its address (no script yet when it was drawn): open it once React has it
  var tries = 0
  var wait = setInterval(function () {
    var s = sheet()
    if (running(s)) {
      clearInterval(wait)
      document.documentElement.setAttribute('data-sheet-ready', '')
      if (location.hash === HASH && !isOpen()) show()
    } else if (++tries > 40) clearInterval(wait)
  }, 150)
  new MutationObserver(function () {
    if (running(sheet())) document.documentElement.setAttribute('data-sheet-ready', '')
  }).observe(document.body, { childList: true, subtree: true })
})()
