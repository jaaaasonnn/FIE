# End-to-end test report

## polish-1 (2026-11-12, branch `polish-1` from `main` at `20d11e6`, not merged)

Four small fixes, one commit each, each with tests and removal proofs (351-362), then the full set.

| Fix | Commit | What changed |
|---|---|---|
| AS27, Messages on phones | `2804b1f` | Below 640 px the inbox opens no conversation by itself: nothing is marked read and the bar's badge does not drop until one is tapped; the row's time label is drawn fresh when its words change. Desktop as before. The tab-tap Messages case runs as a normal test (mark removed). Proofs 351-353. |
| AS26, Messages tab redirect | `c4a59e4` | Looked at, **not changed**: no small, safe fix (the bar is drawn without knowing the person, Next's Link moves to the `href` it was drawn with, and every alternative adds script to desktop or touches sign-in and roles). Reasoning in FINDINGS. |
| AS22, missing listing answered 200 | `2a5db30` | An id no listing has answers **404** with the same "Listing not found" (drawn by the browser: no Suspense boundary on these pages, so Next sends its error document for `notFound()`; status and `noindex` are in the answer). A listing that exists but is not shown (switched off, on hold, host suspended) is unchanged: 200, so its host, an admin and a guest who booked it still see it. Proofs 354-355. |
| AS29, never "NaN" | `a272e86` | With no usable rate, every page shows dollars only, admin says "Not set", and `POST /api/payments` refuses before anything is written or Paystack is asked (one Sentry alert per process, IDs only). No sum changed. Proofs 356-362. |
| AS30, crawl test | `9d40680` | Test only, cause proven (below). |

### The rate review (fix 4), place by place, before anything changed

With no stored rate, as the code read before `a272e86` (`Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)`):

| Place | Env missing | Env empty | Env placeholder text (the preview) | Env 0 or negative |
|---|---|---|---|---|
| Explore cards (server) | 15.5, made up | "About GH₵ 0" | **"About GH₵ NaN"** | "GH₵ 0" / negative |
| Search cards, phone and desktop | 15.5 | 15.5 | 15.5 | negative while loading, then 15.5 |
| Listing, checkout (and rent line), Trips, booking page, payments, wishlist, desktop Featured (the pages' shared rate) | 15.5 | 15.5 | 15.5, made up (`/api/exchange-rate` said `null`, which was ignored) | 15.5 |
| Admin | "GH₵ 15.5" shown as the rate whatever was set | | | |
| Starting a payment | **charged at 15.5** | refused "Amount too small" | carried on: NaN pesewas (written as null), Paystack sent `amount: NaN` | refused "Amount too small" |
| Payouts, refunds, disputes, deposit cover, host dashboard and payouts page | never read a rate: each payment's stored pesewas | | | |
| Emails and SMS | stored rate only: dollars only with none | | | |

After: one rule in `lib/exchangeRateShared.ts`; every place above shows dollars only, never NaN; payments refuse
(503 `NO_EXCHANGE_RATE`). Left as it was: the pages' shared rate starts at its provisional 15.5 while its answer is on
its way, so with no rate a page drawn in the browser can show a cedi line for a moment (Explore and search never do).

### The full set

`e2e/.reports/p1-final/` on `a272e86` (the four fixes), then `e2e/.reports/p1-final-2/` on `9d40680` (after the
crawl test fix), each from a clean stack (`down`, `.next` removed, `up --build`, again before Chromium run 2), under
`caffeinate -dims` on mains power, `next dev` off, each suite in its own folder, `done.txt` one line per suite. The
owner's `AGENTS.md` was stashed under its own name for the proofs only; SHA-256 the same before and after
(`agents-*.txt`, `stash.txt`).

| Check | `p1-final` (`a272e86`) | `p1-final-2` (`9d40680`) |
|---|---|---|
| Lint, type check | pass (0 errors, 38 warnings, none new) | pass (same) |
| `npm run test:tz` | 1729 of 1729 in each of the six zones | 1729 of 1729 in each |
| Proof runner's own test | 4 of 4 | 4 of 4 |
| Money rules | clean before and after | clean before and after |
| Chromium, races at 50, run 1 | 286 passed, **1 failed** (crawl, signed out: AS30) | **287 passed**, 0 failed, 0 flaky |
| Chromium, races at 50, run 2 (fresh stack) | 286 passed, **1 failed** (the same) | 286 passed, **1 flaky** (AS31, below), 0 failed |
| Contention, alone | 5 passed | 5 passed (realistic: 100 and 200 booked, 0 busy; stress: 7% busy, nothing booked twice) |
| Chaos | 18 passed (17 and the new no-rate test) | 18 passed |
| Other five set-ups | 450 passed, **5 failed** (crawl, signed out, each: AS30) | **455 passed**, 0 failed, 0 flaky |
| Removal proofs | **all 362 hold** | not run again: the only change is `crawl.spec.ts`, which no proof names |

No AS19 retry was logged in either set.

**AS30 (proven, fixed in the test).** After AS22 the signed-out crawl failed in every set-up on 404s for listing
links it collected from search. Each such listing was made by another test seconds before or during the crawl and
was gone when the crawl checked its links at the end (cuid times against the crawl's start; retries hit different
ids). Alone: 5 of 5 passed (`crawl-alone`); beside explore, search-sheet and hearts: 3 of 3 failed (`crawl-beside`);
with the fix: 30 of 30 (`crawl-beside-fixed`). A 404 on a listing link is now broken only while the listing exists.

**AS31 (not proven, nothing changed).** `races/bookings.spec.ts:204` ("the expiry job runs at the moment a late
payment lands") was flaky once: a round's set-up booking got 409 `DATE_CONFLICT` eight times, then the retry passed.
The failed try ran across midnight UTC (23:59:10 to 00:00:08). The midnight theory (day offsets in `World.dates()`)
was checked and ruled out: `dates()` reserves each check-out day, so a one-day shift never reaches a booked night (0
clashes in 200 fake-clock calls). Not reproduced in 600 rounds alone or in the whole Chromium suite again (287 of 287,
`as31-suite`), with a probe that would have logged the clash. So the requirement of zero flaky is **not met** for
`p1-final-2` Chromium run 2; details and the next step in FINDINGS AS31.

### Bundle, exact (`p1-final-2/bundle-exact.txt`, file by file in `bundle-vs-s4-final.txt`)

| Page | Phone (limit 350 KB) | Desktop |
|---|---|---|
| Home | 253.042 -> 253.154 KB | 244.242 -> 244.354 KB |
| Search | 214.563 -> 214.702 KB | 649.096 -> **649.206 KB** (limit 650) |
| Listing | 228.069 -> 228.937 KB | 219.270 -> 220.137 KB |
| Checkout | 210.959 -> 211.075 KB | 202.159 -> 202.275 KB |
| Guest dashboard | 229.236 -> 229.342 KB | 220.437 -> 220.542 KB |
| Host dashboard | 224.446 -> 224.551 KB | 215.646 -> 215.751 KB |
| Admin | 216.764 -> 216.949 KB | 207.964 -> 208.149 KB |

- Desktop search: the same 17 files as `s4-final` (renamed by hash), +113 bytes: the chunk carrying the commit hash
  +105 (AS21), the shared chunk holding the rate context +2, the search page's chunk +6 (the no-rate branch of the
  card line). No new script file. 0.794 KB of room left.
- Listing +888 bytes and one more file on both widths: "Listing not found" in its own file (`ListingNotFound.tsx`),
  shared with the 404 page.
- Layout shift 0, accessibility 0, text fit at 320/360/390/430 px, field size, tab-tap (Messages now a normal test),
  installed app and offline: all passed in both Chromium runs and the phone set-ups.

## app-shell, stage 4: finished (2026-11-11, `75cbaaf`, branch `app-shell-4`, not merged)

Stage 4 is finished: built, proven in emulation, checked by the owner on a real iPhone 17 Pro and a real Android phone
with Chrome, and the one problem the phones found (AS25, a tap on a bottom-bar tab showed nothing for a second or two)
fixed and proven. **Not merged**: `main` is still at `dfc51fa`.

### The final verification

Run on `75cbaaf` from a clean stack (`down`, `.next` removed, `up --build`, and again before the second Chromium
run), under `caffeinate -dims` on mains power, `next dev` off. Each suite in its own folder, `e2e/.reports/s4-final/`
(`done.txt` has one line per suite with its exit code, the commit and the time). Contention alone. Nothing was re-run
inside the set. The owner's uncommitted `AGENTS.md` was stashed under its own name for the proofs only and popped
afterwards; its SHA-256 before and after are in `agents-before.txt` and `agents-after.txt`, and `stash.txt` ends with
the byte-for-byte check. (AGENTS.md has been committed twice in the repository's history, both long before stage 4 and
both Next's own generated block (`384e0a0`, `0240b77`); the owner's heading change was never committed.)

| Check | Result |
|---|---|
| Lint, type check | pass (0 errors, 38 warnings, none new) |
| `npm run test:tz` | 1718 of 1718 in each of the six zones |
| Proof runner's own test | 4 of 4 |
| Money rules | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50, run 1 | **282 passed**, 46 skipped, 0 failed, **0 flaky** |
| Chromium suite, races at 50, run 2 (fresh stack) | **282 passed**, 46 skipped, 0 failed, **0 flaky** |
| Contention, alone | **5 passed** (realistic: 300 of 300 booked, nobody told busy; stress: nothing booked twice, 6% and 39% busy) |
| Chaos | **17 passed** |
| Other five set-ups (Firefox, WebKit, tablet, iPhone, Android) | **430 passed**, 160 skipped, 0 failed, **0 flaky** |
| `installed-app.spec.ts` x 100 (AS23), no retries | 1,297 passed, **3 timed out** (AS23, below) -> after the harness fix **1,300 of 1,300** (2 stalls recovered, `installed-app-x100-final`) |
| `tab-tap.spec.ts` x 20 in Chromium, iPhone and Android, no retries | 437 passed, **3 failed** (Messages, Chromium; AS27, below) -> after the test waits for every answer, with Messages marked `test.fail('AS27')` in Chromium and Android: **440 of 440 as expected**: 400 passed, and the 40 Messages runs in Chromium and Android failed as marked, every one for the AS27 shift (`tab-tap-x20-final`) |
| Removal proofs | **all 350 hold** (`proofs.log`: 350 held, 0 did not; git status clean at the end) |

So the set as run had 6 failures outside the suites, all in the repeats, each proven before anything changed (below), and both changes are in the tests only. No AS19 retry was logged anywhere in the set. None of the AS18 items failed. The 46 skipped in Chromium are the
picture and measurement specs that run only when asked (shots, `tab-timing`), and the tests for other set-ups.

### Bundle, exact

`e2e/.reports/s4-final/bundle-exact.txt`, and file by file against the stage 4 full set in `bundle-vs-s4-full.txt`.

| Page | Phone (limit 350 KB) | Desktop |
|---|---|---|
| Home | 250.627 -> 253.042 KB | 244.244 -> 244.242 KB |
| Search | 212.148 -> **214.563 KB** | 649.098 -> **649.096 KB** (limit 650) |
| Listing | 225.654 -> 228.069 KB | 219.271 -> 219.270 KB |
| Checkout | 208.544 -> 210.959 KB | 202.161 -> 202.159 KB |
| Guest dashboard | 226.821 -> 229.236 KB | 220.438 -> 220.437 KB |
| Host dashboard | 222.031 -> 224.446 KB | 215.648 -> 215.646 KB |
| Admin | 214.349 -> 216.764 KB | 207.966 -> 207.964 KB |

- Phones: +2.415 KB on every page, all of it `bar.js` (1.189 -> 3.606 KB: the tab taps, AS25). Largest 253.042 KB.
- Desktop: the same files as the stage 4 full set except the one carrying the commit hash as Sentry's release (AS21),
  2 bytes smaller at `75cbaaf`. No new script on a desktop.
- Layout shift 0, accessibility 0 (no baseline), text fit at 320, 360, 390 and 430 px, in both Chromium runs and the
  phone set-ups; the tab placeholders also pass the phone fit check at those widths.

### What the repeats found, proven before anything changed

Two reruns in between, with my first attempts, are in the same folder and count against the work, not the app:
`installed-app-x100-after` 1,299 of 1,300 (the "Tracing has been already started" failure of the first AS23 fix, below);
`tab-tap-x20-after` 400 passed, 40 failed, every one Messages in Chromium and Android, where my new wait never ended
(a redirect hop and the mark-read answer, whose body the inbox never reads, were counted as still open). Both fixed in
the tests, then the `-final` runs.

**AS23: an app window that stops answering Playwright at start-up (cause proven, fixed in the harness).** The three
timeouts left their profiles behind; Chromium's own history in each (and in the two from 2026-11-07) holds one visit,
the first `/offline.html`, never the test's next page. A probe timing every step of `installedApp()` over 600 windows:
2 stuck in `launchPersistentContext` (normally 0.6 s, at most 1.2 s), Chromium already showing the page; Playwright's
launch `timeout` did not end it. With the trace off (1,200 windows) 8 stuck, 6 in `setExtraHTTPHeaders` and 2 in the
launch: the first DevTools calls after the window starts, whichever they are. It is not tracing (that was my first
guess; it was wrong) and not the app (no request of the test's had been made). A first fix that bounded only the
launch left the stuck window known to the runner, and the next test failed with "Tracing has been already started" (1
of 1,300). The fix (`startApp`, `e2e/lib/installedApp.ts`): the whole start-up has 20 s; then that Chromium is ended by
its profile folder, its start-up let fail, and the window started again once, logged `[e2e] AS23`. Drill
(`E2E_AS23_DRILL=1`, every first start gives up at 200 ms): 40 of 40. The real helper, 1,200 windows: 1,200 passed, 4
stalls recovered. Why Chromium's `--app` window stops answering is not known.

**AS27: the inbox marks its first conversation read by itself, and its row moves (cause proven, recorded, not
changed).** The three tab-tap failures were all Messages in Chromium, layout shift 0.0002 on the inbox's time label. The
inbox selects its first conversation when it loads and marks it read; when that answer comes, the unread count beside
the row goes and the label moves 32 px (probe: x 252 -> 284). On a phone the thread is not shown, so opening Messages
marks the newest conversation read unseen. Separately the 8 s poll's "Just now" -> "1m ago" moves the right-aligned
words 11.9 px. All older than this branch (`19f6ebb`). The test raced the answer (3 of 20); it now waits for every
answer (the mark-read's body is never read, so a request counts as done when its answer arrives), and fails every run
for exactly this reason in Chromium and Android, marked `test.fail('AS27')`. Options for the owner in FINDINGS.

### AS25: a tap on a bottom-bar tab (found on the real phones, fixed)

Measured first on the contention lane at 5-15 ms from the database (`e2e/load/results/tab-timing-before.md` and
`-after.md`): tap to page Trips 274 ms (its server answer 196 ms, about 18 database round trips one after another),
Profile 117, Messages 147 (a redirect, then the inbox: AS26), Wishlists 52, Explore 56. The slowest step was Trips'
server render: a session read, then six reads that each checked the session again before reading their data. Locally
no tab is near a second; on the phones the rest is the network and the preview's servers. Nothing on screen changed
during the wait: there is no `loading.tsx`, so Next keeps the old page until the server's whole answer is in.

What changed (`dbca6fb`, `a204723`; proofs 345-350):
- `public/bar.js` (phones only, once React has the page): the tapped tab is marked at once and its placeholder drawn
  over the old page in the new page's shape, until the new address is in place; a second tap on the tab being opened
  does nothing (before: three taps, three requests to the server). Explore's placeholder takes the header's place at
  the tap. Not `loading.tsx`: it would stream its fallback on every full load, against the server-first rule.
- One session read per page drawn (React's `cache` on `getUserFromToken`; route handlers unchanged): Trips 274 -> 191
  ms tap to page, 203 -> 140 ms full load, 18 -> 10 round trips one after another. Same data.
- Guard: `tests/journeys/tab-tap.spec.ts`, every move and API answer 1.5 s late with prefetches refused: marked and a
  placeholder on screen within 150 ms at 390 px in Chromium, iPhone and Android, layout shift 0 (WebKit reports none),
  the placeholders' titles where the pages' are, the second tap one move, and the phone fit check.
- Not yet checked on the real phones. The Vercel preview of `75cbaaf` built ("success", 2026-11-11), so it is there.

### What was proven in emulation

Chromium app window (`--app`, `display-mode: standalone` really matching), the iPhone and Android set-ups:
- the manifest and icons, pixel by pixel; Chromium's own install check passing;
- the top of the screen in the app (header, search bar, the header's strip, the map's top bar, Explore, the sheet)
  clear of a 59 px status bar, zero layout shift and the fit at 320-430 px, and a browser tab exactly as on `main`
  (72 pictures, to the pixel);
- the service worker: only in the app window, only `/offline.html`, offline and back, prices never stale, HTTP errors
  passed on, other caches deleted;
- the install hint; no zoom on any field (16 px on phones); the tab taps (AS25).

### What the owner verified on the real phones

**iPhone 17 Pro** (Safari and the installed app), from `e2e/REAL-PHONE-CHECKLIST.md`:
- the browser pass (step 1), the install (step 2), the top spacing in the app (step 3), edge-swipe back from the
  left edge (step 4: it goes back, so stage 4b's back arrow is not needed), signing in inside the app (step 5), the
  offline page (step 7), and a Paystack test payment from the installed app (step 6);
- the date-zoom fix (`71dc75e`: iOS no longer zooms in when a field takes focus; the cause was found on this phone).

**Android phone with Chrome**: every step of the checklist passed. Found there and on the iPhone: Trips slow to answer
a tap (AS25), now fixed in emulation.

### Still unverified

- The AS25 fix on either real phone (the preview of `75cbaaf` has it).
- iPhone: signing out inside the app and "sign out everywhere" (step 8), and uninstalling (step 9); iOS clearing an
  unused app's storage after a while (only time can show it).
- AS26 on a real phone: whether Messages still feels slower than the other tabs (one more round trip); AS27 on a
  phone (the newest conversation marked read on opening Messages).
- Anything on other phones: one iPhone and one Android phone were checked.
- Production: the real-phone checks ran on the Vercel preview with its own test database and Paystack test keys; the
  live site, live payments and the live database were not part of stage 4.

## app-shell, stage 4: the installed app (2026-11-07, `b79bfb5` then `443c158`, branch `app-shell-4`, not merged)

Run on `b79bfb5` from a clean stack (`down`, `.next` removed, `up --build`, and again before the second Chromium
run), under `caffeinate -dims` on mains power, `next dev` off. Each suite in its own folder, `e2e/.reports/s4-full/`.
Contention alone. Nothing was re-run inside the set.

| Check | Result |
|---|---|
| Lint, type check | pass (0 errors, 38 warnings, none new) |
| `npm run test:tz` | 1713 of 1713 in each of the six zones |
| Proof runner's own test | 4 of 4 |
| Money rules | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50, run 1 | **270 passed**, 45 skipped, 0 failed, **0 flaky** |
| Chromium suite, races at 50, run 2 (fresh stack) | **270 passed**, 45 skipped, 0 failed, **0 flaky** |
| Contention, alone | **5 passed** (realistic: nobody told busy; stress: 42% busy, nothing booked twice) |
| Chaos | **17 passed** |
| Other five set-ups | **387 passed**, 148 skipped, 0 failed, **0 flaky** |
| Removal proofs | 342 of 343 held; **341 did not** (below). After the fix, 340 and 341 hold (`443c158`): **all 343 hold** |

No AS19 retry was logged anywhere in the set. None of the AS18 items failed.

**Proof 341, proven and fixed in the test (`443c158`).** The proof removes the rule that moves the phone map's top
bar below the status bar, and the test still passed. A probe in the app window, Close's top edge from the moment it
shows: with the rule 524 px, then 78, then 71 from 274 ms on; without it 856, 218, 68, 19, then 12 from 298 ms on.
The map slides up over 280 ms, and the test measured straight after Close appeared, far down the screen, so "below
59 px" passed with or without the rule. The test now waits for the slide's animation to finish before measuring.
Nothing in `src/` changed. Afterwards: proofs 340 and 341 hold, the whole installed-app spec 39 of 39 (3 runs), the
changed test 179 of 180 in repeats (below, AS23).

**AS23, not proven.** In the first 20 repeats of the changed test, one run reached the 2-minute limit inside the
app window and passed on its retry. Playwright's trace does not record the app window (it is launched outside the
test's own context), and the trace shows the test never reached its browser-tab half. Then: 80 timed probes of the
same steps (20 and 60 at once, every step logged; the slide's wait never above 300 ms, closing the window never
above 0.6 s), 40 repeats of the real test, and 120 of a copy that logs every step: no hang. One in 180 repeats,
outside the full set, step not known. Recorded in FINDINGS; nothing changed for it.

### The spike (display-mode and safe areas)

- Playwright's bundled headless shell has no `display-mode: standalone` and reports no install problems, even with
  an icon missing. Full Chromium (Playwright's `chromium` channel) opened with `--app=<address>` is a real app
  window: `display-mode: standalone` matches on every page it navigates to. That is what the tests use.
- CDP `PWA.install` installs for real and writes app shims to `~/Applications/Chromium Apps.localized` on this Mac
  (removed after the spike; the tests never install). `isMobile` in that window opens it blank, so it is not used.
- CDP `Emulation.setSafeAreaInsetsOverride` sets `env(safe-area-inset-*)` per page and keeps it across navigations:
  the iPhone set-up's insets (top 59, bottom 34).
- `Page.getInstallabilityErrors` works in full Chromium with a profile of its own (in incognito it always reports
  `in-incognito`).

### What was built (separate commits)

1. Manifest and icons (`4c38d14`): `/manifest.webmanifest`, standalone, start and scope `/`, `#FAF7F2`; icons drawn
   from `icon.png` (`scripts/app-icons.mjs`): 192 and 512 "any", 192 and 512 maskable (mark within 36% of the
   middle, inside Android's 40% circle), a solid 180 px Apple icon; iPhone title FieGH, status bar `default`. No
   `theme-color` tag. Preview of every icon, plain, maskable in the circle and rounded-square masks, and as an
   iPhone shows it: **`e2e/.reports/stage4-icons/preview.png`**.
2. Top spacing in the installed app only (`305bbd0`, revised `5c3efef`): under `@media (display-mode: standalone)`
   in `globals.css`, the header, the search bar under it, the header's strip when it steps aside and the phone map's
   top bar clear `env(safe-area-inset-top)`. A browser tab is unchanged.
3. Service worker and offline page (`ce20110`): `/sw.js` (`no-cache`), one cache `fiegh-offline-v1` holding only
   `/offline.html`, GET page loads only, the offline page only when the network fails outright (never on an HTTP
   error), nothing else touched, `skipWaiting`, `clients.claim`, other caches deleted, registered by `shell.js` only
   in standalone. Kill switch in CLAUDE.md.
4. Install hint (`9d027c9`): a folded row on `/account` only, server-drawn, no script; hidden on desktop and in the
   installed app.

Tests and proofs (`9b3518b`, `4ba1b02`, `443c158`): `installed-app.spec.ts` (13 tests), `offlineWorker.test.ts`
(7), removal proofs 329-343, `serviceWorkers: 'block'` in the config.

### Guards

**Bundle, exact** (`e2e/.reports/s4-full/bundle-exact.txt`, against stage 3's full set `as3-full2`):

| Page | Phone | Desktop |
|---|---|---|
| Home | 250.294 -> 250.627 KB | 244.246 -> 244.244 KB |
| Search | 211.815 -> **212.148 KB** | 649.100 -> **649.098 KB** |
| Listing | 225.321 -> 225.654 KB | 219.273 -> 219.271 KB |
| Checkout | 208.211 -> 208.544 KB | 202.163 -> 202.161 KB |
| Guest dashboard | 226.488 -> 226.821 KB | 220.440 -> 220.438 KB |
| Host dashboard | 221.698 -> 222.031 KB | 215.650 -> 215.648 KB |
| Admin | 214.016 -> 214.349 KB | 207.968 -> 207.966 KB |

- Phones: +0.333 KB on every page, the worker's registration in `shell.js`. Largest 250.627 KB, under 350.
- **Desktop search is 649.098 KB, not 649.100.** No new script on a desktop: every desktop page loads the same
  files as at stage 3, with the same names and sizes, except one: the shared 94 KB chunk carrying the commit hash as
  Sentry's release (AS21), 93,953 bytes compressed at `50b6f9a`, 93,951 at `b79bfb5`. `grep` of the build finds the
  commit's hash in that one browser file only. Exactly 649.100 is reachable only on a commit whose hash compresses
  as `dfc51fa`'s did; compare files, not totals.
- Layout shift 0, accessibility 0 (no baseline), text fit at 320, 360, 390 and 430 px: in the Chromium runs, and in
  the installed app's own tests (shift and fit in the app window; the hint and the offline page fit and pass axe).
- No payment, payout, booking or `src/proxy.ts` change (`git diff dfc51fa -- src/proxy.ts src/lib/pay* src/lib/payout*
  src/lib/booking* src/app/api` is empty).

**A browser tab is pixel-identical to `main`**: 12 pages (9 signed out, 3 signed in) at 320, 390, 430 and 1280 px
in Chromium and in the iPhone and Android set-ups, 72 pictures, every one to the pixel (0 within one colour level)
against a build of `main` with the same font files (`e2e/.reports/stage4-compare/final-summary.txt`). `/account` on
a phone is compared down to the end of Help (the hint is below it, on purpose). Two of `main`'s own runs differed
from each other (a photo's rasterising), the branch matched one of them in each case. The first comparison differed
in every letter: proven to be different Manrope files between the two builds (AS20), not the branch.

### Proven in emulation, and what still needs a real phone

Proven here (Chromium app window, iPhone and Android set-ups):
- the manifest, the icons pixel by pixel (sizes, solid, maskable mark inside the circle), Chromium's own install
  check passing; every page links them;
- in the app window: the header, the search bar, the header's strip, the map's top bar, Explore and the search sheet
  clear a 59 px status bar drawn over the page; zero layout shift and the fit at 320-430 px;
- the worker: registered only in the app window, never in a tab at phone or desktop width (no request for `/sw.js`);
  stores only `/offline.html`; offline shows "You are offline" and Try again comes back once online; a changed price
  shows at once; a 404 is passed on as it came; other caches are deleted;
- the hint folds open, fits and passes axe on a phone, hidden on desktop and in the app;
- a browser tab is exactly as on `main`.

Needs a real phone (`e2e/REAL-PHONE-CHECKLIST.md`: iPhone 17 Pro and an Android phone with Chrome):
- the real status bar, Dynamic Island and home indicator; whether iOS's "default" bar really gives an inset of 0;
- Safari's floating toolbar over the bottom bar, and the strip under the bottom bar (AS13, emulated only);
- the install screens and the icon each phone draws (its own mask shape);
- edge-swipe back in the installed iPhone app (no: stage 4b, a back arrow);
- how Paystack's page opens from the installed app and how the guest gets back; sign-in inside the app; signing
  out; aeroplane mode with a real network stack; iOS clearing an unused app's storage.

It needs this branch on the internet over https, with Paystack test keys and a database that is not the live one.
Vercel's deployments have failed since August.

## app-shell, stage 3: AS8 and the listing page's heart (2026-11-07, `50b6f9a`, branch `app-shell-3`, not merged)

Run on `50b6f9a` from a clean stack (`down`, `.next` removed, `up --build`, and again before the second Chromium
run), under `caffeinate -dims` on mains power, `next dev` off. Each suite in its own folder,
`e2e/.reports/as3-full2/`. Nothing was re-run. **Not a clean set: 3 flaky tests in Chromium (AS15-AS17), causes
not proven.**

| Check | Result |
|---|---|
| Lint, type check | pass (0 errors, 38 warnings, none new) |
| `npm run test:tz` | pass in each of the six zones |
| Money rules | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50, run 1 | 255 passed, 44 skipped, 0 failed, **1 flaky** (AS15) |
| Chromium suite, races at 50, run 2 (fresh stack) | 254 passed, 44 skipped, 0 failed, **2 flaky** (AS16, AS17) |
| Contention, alone | **5 passed** |
| Chaos | **17 passed** |
| Other five set-ups | **387 passed, 143 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 327 hold** (315-322 the listing heart, 323-327 AS8) |

**Bundle, exact (sum of each file's compressed size; the guard now sums to the byte, no rounding):**

| Point | Desktop search | Phone search | Listing (desktop / phone) |
|---|---|---|---|
| Before 1a (`d5103bf`) | 650.007 KB | 209.551 KB | 218.494 / 224.542 KB |
| After 1a (`a021fe8`) | 649.086 KB | 211.562 KB | |
| After Job 2 (`703ed49`) | 649.084 KB | 211.769 KB | 219.270 / 225.317 KB |
| Full set (`50b6f9a`) | **649.100 KB** | **211.815 KB** | 219.273 / 225.321 KB |

Every phone page is under 350 KB (largest: guest dashboard 226.488 KB). Desktop search has 0.9 KB of room, so
desktop search-card hearts (about 1.3 KB) wait for a branch that slims the map; the desktop card heart stays hidden
and proof 302 stands. AS8 saved 0.92 KB, not the 2.5-4 KB first estimated.

**What was built.** 1a: a phone's search parts in `app/search/phoneParts.tsx`, fetched at a phone's width only
(`lib/phoneOnly.ts`), the server's HTML kept until then. A Suspense boundary was tried first and dropped: React
19.2 sends a finished boundary's HTML after the page and swaps it in with a script, so with no script the pill was
missing. Job 2: the listing page's heart is the cards' `HeartButton` and store (no `?userId=`), and a heart
pressed while signed out saves that home once after logging in (sessionStorage, 10 minutes, one use).

### What failed in the first full set (`098933c`, `e2e/.reports/as3-full/`), and what was done

Each cause was proven before anything was changed.

1. **A tap on a phone's chip or Clear filters was lost** (iPhone: one failure, one flaky). The trace: the phone's
   code was asked for at 753 ms and arrived at 970 ms; the tap came at 780 ms, on the server's copy, which has
   nothing behind it. A regression from 1a. Fix: the server's copy of those buttons is drawn disabled, and they
   work once the code has come (the existing rule: a form drawn by the server is disabled until the page runs).
   Same look. The pill is a link and works anyway. New tests hold the code back (proofs 326, 327).
2. **Proof 301 was stale**: the line it removes moved to `phoneParts.tsx` in 1a. It points there now.
3. **Proof 319 did not hold.** The mutant passed 2 runs in 10. A first explanation (checked too early) was wrong.
   Proven from a trace of a passing mutant: the page being left by the reload got its saved ids at 6207 ms, read
   the waiting save, and its request (6208 ms) was cancelled by the navigation, so the next page found nothing to
   read. The test now leaves the waiting save only once the first page knows the saved homes; the mutant fails
   10 runs in 10.

### Flaky in the second full set (AS15-AS17), and the check that followed

Each failed once and passed on its retry. None is in code stage 3 changed (it changed search, listing and heart
code only; the test harness and these tests are the same on `main`).

**The check (2026-11-07):** each test repeated beside the full Chromium suite and two other test processes, no
retries, on `main` at `d5103bf` and on `app-shell-3` at `d799dde`, each from a clean stack, mains power,
`caffeinate -dims`, `next dev` off (`e2e/.reports/flake-main/`, `flake-shell3/`).

| Test | `main` | `app-shell-3` | Cause |
|---|---|---|---|
| AS15, `races/rent.spec.ts:44`, 250 runs each | 0 | 0 deadlocks (1 run failed in its set-up with 503 "busy", AS18) | **NOT proven**: a Postgres deadlock (`40P01`) in the test's own `user.deleteMany()` clean-up; did not recur in 500 runs |
| AS16, `races/bookings.spec.ts:302`, 250 rounds each | 0 | 0 | **NOT proven**: a 409 without a code; did not recur in 500 rounds. Every 409 was kept with its body (a logging file preloaded into the test process, outside the repo): all 106 were `HOME_UNAVAILABLE` |
| AS17, `races/payout-retry.spec.ts` (a2), 204 rounds each | 0 | 0 (its copy in the load suite: flaky at round 9) | **Proven**, below |

**AS17, proven.** In the round 9 flake the payout reached `PROCESSING`. Paystack's log for it: the planned 500,
then 456 ms later a lookup (404) and one transfer (200). A run that read its list of due stays before the payout
existed reached the stay after its retry had been claimed (the claimer "dead"), took the claim through
`initiateHostPayout`, asked Paystack first and sent once under the same reference. A probe holding a run at an
earlier stay reproduced it each time its set-up worked (2 of 2). Money is safe (one transfer); in production a
retry whose claimer died can go out at once instead of after 15 minutes. The AS2 kind. No payout code changed; it
stays on the list to decide before `PAYOUTS_ENABLED`, with AS6 and AS11.

**AS17, the test fixed** (as the suspended-host test was, AS12: the order of the set-up closes the window). The
(a2) test makes its failed payout as the job writes it before the stay falls due (`failedPayout(..., { rowFirst:
true })`), so no run, this test's or another's, can hold the stay in a list without a payout. Every assertion is
as strict as before. A new test, "(a2) on demand", starts such a run on purpose (held at another stay while the
stay is in its list): it passes with the order and fails every time without it (5 of 5; removal proof 328).

**AS18, noted only.** Under that heavy extra load (the suite took 25 minutes instead of 15) these timed out on
both branches: the three Resend tests (`resilience/services.spec.ts:23`, `:39`, `:51`), `races/accounts.spec.ts:63`,
`races/bookings.spec.ts:173`, and a 0.0002 layout shift on the inbox's time label (`perf/layout-shift.spec.ts:49`).
Not investigated.

**AS17 fixed in the test, and AS19** (2026-11-07, `46af71d`, `e2e/.reports/as17-verify/`). Under the same heavy
load, retries off: removal proof 328 holds (all 328 hold), "(a2) on demand" 12 of 12, and every one of 201 (a2)
rounds that reached its payout passed. But one (a2) run failed before its payout existed: the set-up booking was
answered 503 "We are busy right now" (`world.ts:169`, `mustBook`). The rent race (1 of 250) and SU7 (1 of 5)
failed the same way in their set-up. About 3 of ~700 set-ups at 2 to 3 times the normal load (AS19). Test set-up
now tries that 503 again (at most 3 attempts, 1 s then 2 s, each retry logged as `[e2e] AS19`); every assertion
as strict, the app unchanged. The booking locking option is revisited only if Sentry shows
`SERIAL_RETRY_EXHAUSTED` in production, or before a marketing push.

## app-shell, stage 2: Explore, the search sheet, phone search (2026-11-07, `deca1e6`, branch `app-shell-2`, not merged)

Run on `deca1e6` from a clean stack (`down`, `.next` removed, `up --build`, and again before the second Chromium
run), under `caffeinate -dims` on mains power. Each suite in its own folder, `e2e/.reports/as2-full2/`. Nothing was
re-run.

| Check | Result |
|---|---|
| Lint, type check | pass (0 errors, 38 warnings, none new) |
| `npm run test:tz` | 1,706 passed in each of the six zones |
| Money rules | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50, run 1 | **249 passed, 42 skipped, 0 failed, 0 flaky** |
| Chromium suite, races at 50, run 2 (fresh stack) | **249 passed, 42 skipped, 0 failed, 0 flaky** |
| Contention, alone | **5 passed** |
| Chaos | **17 passed** |
| Other five set-ups | **355 passed, 135 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 314 hold** (290-312 for stage 2, 313 and 314 new) |
| Layout shift at phone width | 0.0000 on every page measured |
| Phone fit, chip fit, accessibility at phone width | all passed |

The two "expected to fail" lines in each Chromium run are the SU10 harness tests that are meant to fail; they count
as passes.

**Bundle, exact (sum of each file's compressed size, `bundle-exact.txt`):**

| Page | Phone (limit 350 KB) | Desktop |
|---|---|---|
| Home | 250.095 KB | 244.047 KB |
| Search | 209.551 KB | **650.007 KB** (cap 650, map included) |
| Listing | 224.542 KB | 218.494 KB |
| Checkout | 208.211 KB | 202.163 KB |
| Guest dashboard | 226.477 KB | 220.429 KB |
| Host dashboard | 221.698 KB | 215.650 KB |
| Admin | 214.016 KB | 207.968 KB |

**Desktop search is 665,607 bytes: 7 bytes over the 650 KB cap.** The guard rounds the total to whole kilobytes
(`Math.round`, `tests/perf/bundle.spec.ts`), so it passes as 650. It was 648.5 at the end of stage 1 and 649.8 at
stage 2's step runs. The growth is in the search page's own file (15.0 KB at stage 1, 16.3 KB now), which carries
the phone-only search card code: AS8, the first job of stage 3. Which later commit added the last 0.2 KB was not
measured (no build of older commits while the set was running). Neither the guard nor the cap was changed: the
owner's call.

### What failed in the first full set (`2499335`), and what was done

The first full set (`e2e/.reports/as2-full/`) had three failing tests. None was re-run until fixed.

1. **"A stale card on the home page opens 'not available'"** (Chromium, Firefox, WebKit, tablet). Stage 2 put
   Explore's phone cards in the home page on desktop too, hidden; `.first()` found the hidden one and could not click
   it. Test fix: the visible link (`:visible`). The two other tests that click or see the first listing link were
   changed the same way (`search-sheet.spec.ts:40`, `chaos/server-first.spec.ts:164`). `pages.spec.ts` (a home
   leaves the home page) counts every link, hidden too, which is stricter, and was left as it was.
2. **"Desktop: the header never moves"** (tablet: the header's top at -8 px). First put down to the header
   shrinking once scrolled; keeping it one height on touch tablets made it -16, so that fix was undone. The cause
   (AS13): the site's styled scrollbar (`::-webkit-scrollbar { width: 6px }`, older than stage 2). In WebKit on a
   touch screen it took room of its own (6 px across, 16 px down), and after a scroll the visible area sat 16 px
   down the page. A bare page with only a sticky header and that rule gives -16; without it, 0. Fix (owner's
   choice): the styled scrollbar is for devices with a mouse only (`@media (hover: hover) and (pointer: fine)`);
   desktop unchanged, the header's own behaviour as before, the test as strict as before. Removal proof 314. **Not
   checked on a real iPad.** The same change ended the "strip under the bar" in the iPhone set-ups at 390 and
   430 px: the visible area now matches the page at 320, 390 and 430 px. Not checked on a real iPhone either.
3. **"A suspended host is not paid"** (Chromium: 3 of 4 tries). Not changed until the cause was proved (AS12).
   - The four failures left nothing to go on: the app log has no times or booking ids, and the end-of-run clean-up
     had removed the people, bookings and payouts.
   - A probe on the test side only (every run of the payout job by any test: its test, start, end and what it
     listed; and the test's own steps with the database's `suspendedAt` and any payout row) over 25 repeats of "the
     payout and what holds it", retries off: **5 of 25 failed**. In each, another test's run of the job started 3 to
     17 ms after the stay was made due and paid it (`paid`, with its payout id): "ID not approved" three times, "home
     switched off" once, "over the transfer limit" once. The test's own run then found a payout and listed nothing:
     `Received: undefined`, as in the full set. In the 20 passes no payout existed before the suspension.
   - On demand: a new test puts another run of the job in the gap on purpose and gets the old result every time
     (25 of 25).
   - Fix: the test suspends the host first, then makes the stay due; its checks are unchanged. 200 of 200 passed
     (the group of tests, 25 repeats, retries off). Unit tests `cronRuns.test.ts`, `payouts.test.ts` (113) and
     `security/suspension.test.ts` (21) and the money-invariant checker passed. Removal proof 313 takes out both
     suspension checks (the job's and `initiateHostPayout`'s) and the test fails. Payout code not touched.
   - **Found on the way (AS11, open):** in 4 of the 5 caught races the payout row was written 1 to 440 ms after
     `suspendedAt`: the run had read the host just before the suspension and went on. A suspension that lands while a
     run is already paying a stay does not stop that one payout. Every run that starts afterwards waits. The owner's
     call before payouts are switched on.

### Polish in this stage (Part A)

Phone header solid (compared with a solid copy over text at 320, 390 and 430 px); the Trips booking card (two-line
title, "Total due now" then "$170.00 · About GH₵ 2,661" each kept whole, Pay now across the card, the rest in even
columns); "Refunds received" in the brand's text colour on phones (blue on desktop as before); **AS10 fixed, desktop
too**: Wishlists write prices as Explore does, cedis first ("About GH₵ 19,577 /night", then "$1,250.50"), whole
dollars without cents, no stray decimals; display only, nothing stored or worked out changed. Pictures:
`e2e/.reports/stage2-shots/after-partA/`.

## AS3 fixed: bursts of bookings (2026-11-04, branch `booking-contention`)

**Cause.** While the tables are small Postgres reads them whole, so a booking's Serializable transaction
collides with every other booking in flight, even on a different home: in effect one commits at a time (about
0.74 s a run at 30-80 ms from the database). The old retry rules (9 runs, 20-200 ms pauses, about 1 s of
waiting) gave up before a burst had drained, and the guest was told "busy". Nothing was booked twice.

**Change (option A, `src/lib/serialRetry.ts` only; no locking or isolation change).** 12 runs; a pause that
grows (50 ms doubling to 2 s, each a random time between half and the whole step); no run starts after 13 s.
A give-up is one Sentry warning (`db_issue: SERIAL_RETRY_EXHAUSTED`, the op and IDs only) and one log line
with the runs, the total wait and why. The four callers (booking, host calendar, listing check, deposit cover)
were reviewed: each body only reads and writes through its `tx`; messages, logs of the outcome and Paystack
calls come after the commit. Each now passes `{ op, ids }`.

**Measuring.** A contention lane: a third app server (3204, pool 20) whose database goes through its own
delay proxy, set by each test. Realistic is 5-15 ms (Vercel `dub1` beside Supabase `eu-west-1`, with room
to spare); stress is 30-80 ms. `races/contention.spec.ts`, 10 rounds a test, one test at a time. Told
"busy", and the slowest answer:

| Rules | Realistic, 10 guests | Realistic, 20 guests | Stress, 10 guests | Stress, 20 guests | Slowest (stress) |
|---|---|---|---|---|---|
| Old (9 runs, 20-200 ms, no ceiling) | 0/100 | **50/200 (fails)** | 10/100 | 110/200 | 9.2 s |
| New, 8 s ceiling | 0/100 | **5/200 (fails)** | 30/100 | 121/200 | 9.3 s |
| New, 10 s | 0/100 | 0/200 | 19/100 | 106/200 | 11.4 s |
| New, 12 s | 0/100 | 0/200 | 10/100 | 86/200 | 13.5 s |
| **New, 13 s (chosen)** | **0/100** | **0/200** | **6/100** | **81/200** | **14.2 s** |
| New, 14 s | 0/100 | 0/200 | 3/100 | 68/200 | 15.5 s (over 15 s) |

Ten guests on the same dates of one home: exactly one booking every round and nobody told "busy", under
every rule. 13 s is the longest ceiling whose slowest answer stays under about 15 s, and is better than the
old rules on both stress bursts. At the stress distance a burst of 20 still outruns it; the test prints that
rate and asserts only that nothing is booked twice and every answer matches the database.

**First full set (`8787678`, stopped, not merged).** Chromium run 1 at 50: 245 passed, 0 failed, **1 flaky**:
`races/bookings.spec.ts`, "the guest cancels at the moment the payment lands", ran past its 400 s limit on the
first try (it takes 314-319 s in earlier full runs) and passed on the retry in 265 s; the foreign-key error in
its log is the clean-up after the timeout. That try ran beside the contention tests' bursts of 100 and 200
bookings on the same Postgres, which, while the tables are small, collide with every other booking (the AS3
cause), and each retry now waits longer. No booking on 3200 or 3201 was told "busy". Fixed in the tests, as
decided: `races/contention.spec.ts` is its own Playwright project, `contention` (one worker), left out of
`chromium` and run alone after the Chromium runs, in every full set and in `npm run e2e`. The 400 s limit
is unchanged.

**Full set (`f44b5fe`, clean, merged).** Clean rebuilds (`down`, `.next` removed, `up --build`), `caffeinate -dims`
on mains power, each suite in its own folder (`e2e/.reports/as3/full2/`). Nothing was re-run.

| Check | Result |
|---|---|
| Lint, type check | pass (39 warnings, none new) |
| `npm run test:tz` | 1,682 passed in each of the six zones |
| Money rules | clean before and after |
| Chromium suite, races at 50, run 1 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Chromium suite, races at 50, run 2 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Contention, alone | **5 passed, 0 flaky** (below) |
| Chaos | **17 passed** |
| Other five set-ups | **274 passed, 36 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 289 hold** (287: the old rules, 20 guests at 5-15 ms told "busy"; 288: the ceiling removed; 289: the Sentry report removed) |

Contention, alone: at 5-15 ms 100/100 and 200/200 booked, nobody told "busy" (slowest 5.7 s and 8.6 s); at
30-80 ms 6/100 and 72/200 told "busy" (slowest 14.6 s and 14.5 s), nothing booked twice, every answer matching
the database; same dates: one booking every round, nobody told "busy". "The guest cancels at the moment the
payment lands" took 302 s and 306 s (limit 400 s). No booking on 3200 or 3201 gave up.

**Next.** Revisit the locking option (B) only if Sentry shows `SERIAL_RETRY_EXHAUSTED` in production, or
before any marketing push.

## AS2 resolved in the tests (2026-11-03, branch `payout-retry-claim`, test code only)

**Cause.** The payout job works on every payout in the database. In both full runs where AS2 showed, its
test overlapped "the payout job starts on two servers at the same moment" (four runs per round, in another
worker). That test's runs took AS2's retry: (b) they sent it and listed it in their own answer; (a) once,
one had claimed it and was still on its way to Paystack when AS2 read the payout. No app defect: payout
code, the cron route and every other app file are unchanged.

**Changes (`3e8810c`, test code only).** The AS2 test checks the payout once no run is working on it, still
requiring one payout row, PROCESSING, one retry and exactly one transfer, and records which run listed it.
`e2e/lib/payoutRetry.ts` holds the shared steps. `races/payout-retry.spec.ts` makes the reproduction permanent:
(b) another run takes the retry first; (a) the claiming run is held at Paystack; (a2) the claimer dies, nothing
happens until the 15-minute limit, then the next run asks Paystack (404) and sends once; (c) three runs at once,
the payout made long ago; (d) three runs find an abandoned claim. (c) and (d) run 20 rounds, or `E2E_ROUNDS`
if more. Each has its own host and checks only its own payouts, settled.

**Proof** (`e2e/.reports/as2c/full/`, each run in its own folder, clean rebuilds, `caffeinate -dims` on mains):

| Check | Result |
|---|---|
| Lint, type check | pass (39 warnings, none new) |
| New tests alone, 50 rounds | 5 passed |
| Money rules | clean before and after |
| Chromium suite at 50, run 1 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Chromium suite at 50, run 2 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Removal proofs 284-286 | all 3 hold (284: the wait removed, (a) fails; 285 and 286: the stale-claim pick-up removed, (a2) and (d) fail) |

AS3 did not show. In the two Chromium runs, AS2's payout was listed by one of the test's own runs every round
(17 and 17); in the 50-round run alone, (b) was taken by another test's run 7 times of 17, (a) 7 of 17, (a2) 1
of 17: the interference is common, and now harmless.

**AS6 (new, Low, open):** a run that loses the claim reports `paid` with the payout still PENDING although it
sent nothing; in (d) two or three runs said "paid" for one transfer in 43 rounds of 50. Fix before
`PAYOUTS_ENABLED` is switched on (option B, payout code: needs the go-ahead).

## app-shell, stage 1: the full set again (2026-11-03, `5de4ce8`, not merged)

Run once on `5de4ce8` (the AS5 keys `ffe265c` and the sign-out test fix in), after a clean rebuild (`down`, `.next`
removed, `up --build`, for AS4), under `caffeinate -dims` on mains power. Each suite in its own folder,
`e2e/.reports/polish2/full/`. Nothing was re-run.

| Check | Result |
|---|---|
| Lint, type check | pass (39 warnings, none new) |
| `npm run test:tz` | 1,675 passed in each of the six zones |
| Money rules | clean before and after |
| Chromium suite, races at 50 | **236 passed, 13 skipped, 0 failed, 0 flaky** |
| Chaos | **17 passed** |
| Other five set-ups | **274 passed, 36 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 283 hold** |
| Bundle guard | desktop search **648 KB** (limit 648); phone pages 202-244 KB (limit 350) |
| Layout shift at phone width | 0.0000 on every page, signed out, signed in, and with every answer 1.5 s late (seven pages) |
| Accessibility at phone width | 0 problems, signed out, guest with an unread message, host |

**Clean: no test failed, none was retried, none flaky, none "did not run".** Every skip is a planned one:
pictures only when asked for (11), the bar is for phones (12), phones only (16), widths set by the fit test in
three set-ups only (6), the map in headless Firefox (4).

- **AS2** passed all 17 rounds. One round (11) is worth recording: the retry was sent (lookup 404, then the
  transfer, 200) and the payout ended `PROCESSING` with one retry, as it should, but **none of the three runs
  listed it** in its answer. In the other 16 rounds exactly one run said "retry sent". So a run can act on the
  retry without reporting it; in the failing round (polish run) a run claimed it and neither sent nor reported.
  Both point at the same place in the retry path. Payout code not touched.
- **AS3** did not show.
- **AS4** did not show: the clean rebuild came first, and `.next/BUILD_ID` was present after the proofs.

## app-shell, stage 1 polish (2026-11-03, branch `app-shell`, not merged)

Phones only; desktop unchanged (desktop search **648 KB**, no desktop page downloads the bar's script). Money,
sign-in, messaging and payout code untouched; no schema or live-database change.

1. **Logo:** Trips' icon is the header logo's own asset and mask (`public/logo-mark.png`), gold on Trips like the
   header, the muted grey elsewhere; `e2e/.reports/app-shell/logo-compare.png` shows them side by side at 24, 28
   and 48 px.
2. **Type scale** (rem): body 15 px, small text 13 px, page titles 24 px, section titles 19 px, card titles 16 px,
   titles at 600, tighter lines; nothing under 12 px but the tab labels (11 px); 44 px targets everywhere.
3. **Nothing outside its box:** a new audit (`tests/layout/phone-fit.spec.ts`) at 320, 360, 390 and 430 px on
   home, search, a listing, how it works, and signed in Trips, wishlist, messages and account. It found 355
   problems at first, none now: the Explore rental types (now sized to their words, scrolling if they must,
   icons hidden below 375 px), Trips' chip and stat cards, the search field ("Accra"), the search dates, the host
   row and title row on a listing (its buttons on their own row on a small phone), a booking's title and status
   pill, the stat card label, and the guest's page-tab row (desktop only now: the bar does that on a phone).
4. **Search dates:** side by side, 44 px, our font and corners, "Add date" or "Wed, 10 Mar", over the browser's
   own date input (its calendar on a tap); no picker code, so the bundle is unchanged.
5. **Header and bar:** header 56 px with the logo at its size; tab labels 11 px, the active one semi-bold in
   `--color-accent-deep` under the gold marker, a slight press, no tap flash, thin top border, lightly blurred.
6. **Trips on a phone:** a compact header ("Hi, <name>", one verification chip), one row of four figures, then
   the bookings; notices after them. Layout only.

Removal proofs 276-283 (the logo mask, the 56 px header, the date face, Trips' order, the 44 px minimum, the
listing title's width, the search field's box, and drawing late answers fresh). Screenshots of the main pages at
360 and 390 px on iPhone and Android: `e2e/.reports/app-shell/pages/`.

**The full set, once (`ce349ba`, each suite in its own folder, `e2e/.reports/polish/full/`):**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each zone |
| Money rules | clean before and after |
| Chromium suite, races at 50 | **233 passed, 13 skipped, 1 failed, 1 flaky** |
| Chaos | 17 passed |
| Other five set-ups | **272 passed, 36 skipped, 2 failed** |
| Removal proofs | all 282 hold (281 re-pointed first, see below) |
| Bundle guard | desktop search 648 KB; phone pages 202-244 KB |

**Not clean. What failed and why** (none re-run to pass):
- *Layout shift at phone width* (failed twice): the booking page 0.135, Wishlists 0.008, when their answers came
  late under load: React moved the loading screen's pieces into place. Older than the polish; reproduced with
  every answer 1.5 s late; fixed by keying each state (AS5, `ffe265c`), and the guard now covers late answers
  (0 on seven pages). Proof 283.
- *"Signing out from the menu"* on iPhone and Android (failed twice each): the test expected Trips' heading
  "Welcome back"; on a phone it is now "Hi, <name>", as asked. The sign-out worked; the test now accepts both.
- *The payout-retry race (AS2)*, flaky: caught with its timings. The fake was never asked anything during the
  retry, yet the payout ended PENDING with its retry counted: the cause is in the app's retry path, which was not
  touched (FINDINGS AS2).
- Proof 281 first did not hold (the fit audit cannot see the listing title's row reliably); it now names a direct
  test of that layout, and holds.
- After the run the stack served a home page linking a stylesheet from an earlier build (AS4, harness); a clean
  rebuild put it right.

The fixes were checked on their own (layout shift 0 with late answers; sign-out passing in all six set-ups;
proof 283 holds); the full set has not been run again.

**Proposals for stage 2** (not built):
- A compact search summary pill at the top of Explore and search ("Accra · 10-12 Mar · 2 guests") that opens a
  full-screen sheet: where, dates (the date picker on demand), who, rental type; Search at the bottom of the sheet.
- Vertical, full-width result cards on a phone: a big photo (swipeable, dots), the heart on the photo, title,
  area, rating, our badge, price per night or month (and the total once dates are chosen), all fixed heights.
- Explore without the top header on a phone: the search pill is the top of the page; the logo in the pill or not
  at all (the bar is the navigation).
- Sticky filter chips under the search pill (rental type, price, bedrooms, checked homes) that stay while the list
  scrolls; the map as a floating button above the bar.
- Loading: skeletons the exact size of the cards, never a centred spinner; pull to refresh on Trips and Messages.
- Transitions: the listing photo growing from the card into the listing page; sheets sliding up; `prefers-reduced-
  motion` respected.
- Empty states with a picture and one action (no trips yet, nothing saved, no messages), in FieGH's voice.
- Scroll: the header hiding on scroll down and coming back on scroll up; scroll position kept on Back.
- The dark bands at the top of Messages, Wishlists and Payments replaced by plain titles on a phone, as on Trips.

## app-shell: AS1 fixed, AS2 investigated (2026-11-02, test code only, not merged)

**AS1** (`6b0a20c`, `c2f64af`): the send-job test had two timing causes, both in the test. It started its runs
before the sign-up emails were in the log (it now waits for all eight); and the job sends the 50 oldest messages due,
so when the races had queued more than that, one round of four runs never reached the test's emails (it now repeats
the same four runs at once until all eight have gone, at most 20 rounds, still requiring each exactly once).
Reproduced the second cause on purpose with 120 older queued messages: the old test fails, the new one passes in 3
rounds. 50 of 50 four at a time; the whole resilience set with 50 copies in one process, 107 of 107. `deliver.ts`
unchanged.

**AS2** (`3553632`): the fake Paystack now times every request, and the payout-retry race prints each round's run
times, what each run said about the payout, and every Paystack request with its timing (also in its failure
message); the assertion is unchanged.

| Run (own results folder, `e2e/.reports/as/`) | Rounds | Result | Fake Paystack answer | Payout runs |
|---|---|---|---|---|
| On its own, nothing else running (`E2E_ROUNDS=600`: this test runs a third) | 200 | 200 passed | within 1 ms, none given up on | 9 ms median, 138 ms at most |
| Inside the full Chromium set, `E2E_ROUNDS=50` | 17 | 17 passed | within 1 ms, none given up on | 18 ms median, 1,050 ms at most |

**So AS2 did not fail again**, in 217 rounds, and the fake was never slow; whether the one failure was a slow fake or
something in the app is still not proved. Nothing was changed in the fake or the waiting, because nothing slow was
found to make robust; the timings are now in place, so if it comes back its message will say which. Payout code was
not touched.

**That Chromium run was not clean** (231 passed, 2 flaky): the send-job test (AS1's second cause, found here and
fixed above) and a new one, **AS3**: in "ten guests book ten different homes at the same instant" one booking got the
app's designed `503 "We are busy right now"` (its serializable transaction aborted eight times under the races'
load). App behaviour, not touched; a decision for the owner (FINDINGS).

## app-shell, stage 1: the phone's bottom bar (2026-11-02, branch `app-shell`, not merged)

From `main` at `c294542`. Phone widths only; desktop untouched. Money, sign-in, messaging and payout code untouched;
no schema change; no live database, switch or environment variable touched. Commits: `048805c` (the shell),
`630d398` (its end-to-end tests and what they found), `3a6f3a8` (layout-shift guard, phone accessibility scan,
bundle guard, removal proofs 270-275).

**What it is.** A bottom bar on phones (Explore, Wishlists, Trips, Messages, Profile) drawn on the server with each
page's tab marked, so it adds no script; FieGH's mark as the Trips icon; the page keeps room for it from the first
paint, the browser never brings a control to rest under it (`scroll-padding-bottom`), the iPhone home-bar area is
respected (`viewport-fit=cover`), and it steps aside while a text field has focus. Signed out, the tabs lead to log
in and back. `/account` (Profile) and `/messages` (to the right inbox) are new. The unread badge is the only script:
`public/bar.js`, 1.2 KB, loaded at phone widths only, asking the new `GET /api/messages/unread`.

**Found by its own tests and fixed before the full run:** the bar's border made it 1 px taller than the room kept
for it; in WebKit the visible height can be shorter than the page's, so pages keep 16 px more; "Pay now" on a
booking could come to rest under the bar on an iPhone SE (fixed with scroll padding); the badge read before the
tab's name to a screen reader (moved after the label).

Pictures (`e2e/.reports/app-shell/`): the mark at 24, 48 and 192 px (`logo-mark.png`); on the iPhone and Android
set-ups, signed out (`*-signed-out.png`), signed in with an unread badge (`*-unread-badge.png`), Trips active
(`*-trips-active.png`), and with a field focused, the bar gone (`*-keyboard-open.png`; the emulators draw no
keyboard).

| Check (each suite in its own folder, `e2e/.reports/shell/full/`) | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Money rules | clean before and after |
| Chromium suite, races at 50 rounds | **231 passed, 7 skipped, 2 flaky, 0 failed, 0 did not run** |
| Chaos | 17 passed |
| Other five set-ups (the bar's phone tests run in iPhone and Android) | 260 passed, 10 skipped, 0 flaky |
| Removal proofs | **all 275 hold** (270-275 new) |
| Bundle guard | desktop search **648 KB** (unchanged), no desktop page downloads the bar's script; phone pages 202-244 KB of 350 |
| Layout shift at phone width (new guard) | 0 on all 11 page loads |
| Accessibility at phone width (new, no baseline) | nothing found |

**Not clean: two flaky tests, not re-run, neither touched by stage 1** (FINDINGS AS1, AS2): the send-job test
started its runs before the sign-up emails were in the log; the payout-retry race ended one round with the payout
safely `PENDING` (most likely a slow answer from the fake Paystack under load; not proved). Nothing paid twice; the
money rules held.

## su10-harness: test processes and fake rules cannot break each other (2026-11-02, branch `su10-harness`)

From `main` at `e457dd1`; test harness only, no app code; no live database, switch or environment variable.

- **No rule without a match.** The fake's control refuses one (400: "A failure rule needs a match ... A rule with no
  match would break every request on the stack."); `fakes.rule` requires a `match` and throws if refused. The two
  tests that scoped a rule to a payment reference (`resilience/paystack.spec.ts`, `chaos/crash.spec.ts`) check the
  reference exists first: the type checker found them once `match` was required. The exchange-rate rule names its
  request (`pair/USD/GHS`).
- **Every rule removed when its test ends**, passed, failed or timed out: an automatic fixture (`fakeRules`,
  `e2e/lib/test.ts`); and at the end of the run, every rule the process added (rules carry the process's id).
- **Clean-up only of its own process.** Each process gets an id (`E2E_RUN_ID`, set in `playwright.config.ts`,
  inherited by its workers; `e2e/lib/runId.ts`); every test person's email carries it (`runEmail`, in all eight
  places a test makes one), and the end-of-run clean-up removes only `e2e-<its id>-…` people.

Tests, `tests/resilience/harness.spec.ts`: a rule with no match is refused, three ways, and none is added; a test
that adds a rule and fails, and one that adds a rule and times out (both expected), leave no rule behind; one
process's clean-up removes its own leftovers and never another's. With the fixture's clean-up taken out by hand,
the rule test fails (9 rules left); put back, it passes.

| Run (retries off, each its own results folder `e2e/.reports/su10/`) | Result |
|---|---|
| The harness tests | 5 of 5 (two of them expected to fail, and did) |
| The whole resilience set | 57 of 57 |
| Smoke, while a second process ran `paystack.spec`, `services.spec` and `switched-off.spec` | smoke 7 of 7 (19:51:02-19:51:15); the second process 30 of 30 (19:50:54-19:51:38), so smoke's clean-up ran in the middle of it |
| The other tests the change touched (fuzz, account races, navigation, accounts) | 39 of 39 |
| Chaos | 17 of 17 |
| Rules left on the fake, test users left in the database | none, none |
| Lint, type check | pass (39 warnings, none new) |

No removal proof added: an end-to-end proof rebuilds the app, which this change does not touch; the rule test was
checked against its fixture by hand instead.

## payments-switched-off: SU7, a home that is no longer available (2026-11-02, branch `payments-switched-off`)

Branch `payments-switched-off`, from `main` at `c27c0bd`, pushed after each commit, **not merged**. Built and
tested on the local test stack only, under `caffeinate -dims` on mains power; no live database, switch or
environment variable touched; no real Paystack, email or SMS.

### SU9 fixed in the test harness (`e2e/lib/db.ts`), not merged yet

As decided, test side only: `deliver.ts` is unchanged, because the app never deletes `MessageLog` rows (only the
test clean-up does), so production cannot reach the 500. The clean-up (`purge`) now never deletes a message a send
job has claimed (`SENDING`): it deletes the people's other messages at once and waits (up to 20 s) for one being
sent to be recorded; inside its transaction it deletes only messages not being sent, and if a job claims one in that
moment the person's foreign key stops the transaction, which waits and goes again.

Proof, retries off, each run in its own results folder (`e2e/.reports/su9/`):

| Run | Result |
|---|---|
| "the send job starts on two servers at once", 50 times, four at a time | 50 of 50 |
| the same 50, while a second Playwright process ran the resilience set twice | 50 of 50 |
| that second process (the resilience set twice) | **not clean: 78 passed, 26 failed**, see below |
| the whole resilience set and 50 copies of the test, in one process (as the full suite runs) | **102 of 102** |
| the whole resilience set once | **52 of 52** |
| lint, type check | pass (39 warnings, none new) |

**The run that was not clean was my test set-up, not the fix.** The 50-run process finished first, and the harness's
global teardown deletes every remaining `e2e-…@fiegh.test` user, including the second process's people: its
failures begin two seconds later (a booking gone mid-test, a user gone under a `Verification` row, a sign-in for a
person deleted). One of those, "verify drops the connection", had added a fake-Paystack rule with
`match: pay.reference` while the reference was undefined, so the rule matched every request and stayed: every
later payment check failed ("CONFIRMED/UNPAID after paying"). The rule (`verify`/`reset`, 105 hits) was removed by
hand. The full suite runs one process, so neither can happen there; both recorded as SU10 (test code, open). The
check was then made the way the full suite runs: 102 of 102.

### SU8 fixed, and the full set again (`06734e5`, `183992d`)

- **SU8** (`06734e5`, test code only): the map and date-picker "file does not arrive" tests end with
  `page.unrouteAll({ behavior: 'ignoreErrors' })`; so do `resilience/loads.spec.ts`'s routed test (the only other
  test that fetches inside a route) and the context fixture (`e2e/lib/test.ts`), whose route for the fake
  Paystack's pages fetches in the Safari set-ups. Checked first: the affected tests 20 of 20, the Safari payment
  tests 8 of 8, no error outside a test.
- **Each suite's own results** (`183992d`): `E2E_REPORT_DIR` puts the JSON results, HTML report and artifacts in a
  folder of the run's own. The run below wrote `e2e/.reports/su8/full/<suite>/`, each with a `summary.txt` naming
  every test that did not simply pass.

**The full set, once, on `183992d`, under `caffeinate -dims`, mains power:**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Harness build | pass |
| Money rules (with SU7's) | clean before and after (2 of 2 each) |
| Chromium suite, races at 50 rounds | **216 passed, 4 skipped (the four "pictures" tests, only when asked for), 1 flaky, 0 failed, 0 did not run, no error outside a test** |
| Chaos | 17 passed |
| Other five set-ups | 226 passed, 4 skipped (the map in headless Firefox), 0 flaky, 0 did not run |
| Removal proofs | **all 269 hold** |
| Bundle guard | pass; **desktop search 648 KB of 650** |

SU7's races at 50 rounds: switched off as the money landed, 41 paid and left alone and 9 refunded in full and
ended; switched off as Pay was pressed, 14 refused before Paystack and 36 paid on a page handed out first and
refunded in full. Never both, never neither, one charge every round.

**Not clean: one flaky test, not re-run.** `resilience/services.spec.ts`, "the send job starts on two servers at
once: each email goes once", failed once and passed on its retry: one of the four simultaneous `send-messages` runs
answered 500 (every email still went exactly once). The app log has the cause: `messageLog.update` in
`src/lib/messaging/deliver.ts` (recording a message's outcome) threw P2025, "No record was found for an update".
The send job works over the whole database, and another test's clean-up (`purge` in `e2e/lib/db.ts`, the only code
that deletes `MessageLog` rows) deleted a row it was sending. Recorded as **SU9**: older than these branches
(`deliver.ts` unchanged since `6c66f24`), not reachable in production today (the app never deletes these rows), a
small fix proposed; needs your go-ahead.

### The rule, as decided

A home is no longer available when its host switched it off (`isActive = false` and `moderationHold = false`) or
the host is suspended (`src/lib/homeAvailability.ts`). **Homes on hold are deliberately outside the rule**: an
admin hold and the automatic contact-details hold store the same thing (`isActive = false`, `moderationHold =
true`), so the code cannot tell them apart, and an automatic hold must never end a guest's booking. Held homes stay
payable, nothing ends their bookings early, money that lands on them is confirmed, and an admin who holds a home
with unpaid bookings handles those **by hand**. A hold-kind column (for example `Listing.holdKind`, set by the two
hold paths) would let admin holds join the rule later; it is a schema change on the live database, not made.

### What changed, in order (one commit each, each pushed)

1. **`65354a6`**: `POST /api/payments` refuses a booking's first payment on such a home (409, `HOME_UNAVAILABLE`,
   "This home is no longer available. You have not been charged."), before a payment row is written or Paystack is
   called, so an open Paystack page is not handed back either. Accepting a request there is refused ("Switch this
   home back on before accepting requests for it."); declining works. Later rent on a paid tenancy is untouched.
   Proofs 263, 264.
2. **`40ccd7a`** (`settlePayment`, the riskiest change): a successful charge on an unpaid confirmed booking on such
   a home is refunded in full: in one transaction the payment is claimed (SUCCESS), the booking ends (`CANCELLED`,
   `SYSTEM`, `HOME_UNAVAILABLE`, `PAID`), open instalments are cancelled, its own nights are released (never a
   host's own blocks), and the refund is recorded through the existing late-payment path (`LATE_PAYMENT`). The home
   is read again inside that transaction after the claim; if it changed since the decision, the charge is decided
   again. A booking paid before is never touched. Proofs 265, 266.
3. **`1bf9483`**: `expire-bookings` ends unpaid bookings and unanswered requests on such a home at its next run,
   whatever their deadline (bookings with no `payBy` too), after asking Paystack: a payment that went through is
   settled (and refunded), one in progress waits. Dry run, or the job switched off: `would-end`. The approved
   messages (guest; the host who switched the home off; the refund with "several working days"). A suspended host
   is not written to: the approved wording covered a switched-off home only. Proof 267.
4. **`a0002bf`**: booking reads carry `homeAvailable` (the home's switches and the host's suspension are not sent);
   a new pay state; checkout, the guest's booking page and dashboard show the message instead of a Pay button; the
   host's bookings show "Home switched off". End-to-end tests, races, money rules. Proofs 268 (end to end), 269.
5. **`d2bd91e`**: removal proofs 36 and 37 (H6, contact details hidden) re-anchored: commit 4 wrapped the lines they
   look for, so the full run could not apply them. Both hold.

`CLAUDE.md`: the suspension rule no longer says a guest can still pay for a suspended host's bookings; a new section
"A home that is no longer available (SU7)", with holds outside the rule and handled by hand.

### Tests

- Unit (`paymentSettle.test.ts`, `homeAvailability.test.ts`, `messaging/homeUnavailable.test.ts`): refused for a
  switched-off home and a suspended host, an open page not handed back, a held home payable and acceptable; money
  after the switch-off refunded once even with webhook and verify arriving twice together; a held home confirmed; a
  booking paid before the switch-off untouched; a switch-off between the decision and the write caught; every case
  of the expiry job; the approved wording.
- End to end (`switched-off.spec.ts`, every browser set-up): SU7's `test.fail()` is now a normal test (refused,
  what the guest sees, ended by the job, both told); a suspended host; **the held-home edge** (stays payable, not
  ended, its payment confirmed, no refund); **switched off while the guest is on Paystack's page** (the payment
  finishes, one charge, one full refund, the booking ends, webhooks on both servers twice change nothing).
  Screenshots: `e2e/.reports/switched-off/`.
- `money.spec.ts`: a stay paid before its home was switched off stands and **is paid out**.
- Races, 50 rounds each: **switched off as the money lands** (webhooks on both servers and the guest's return in the
  same tick): 40 rounds paid and left alone, 10 refunded in full and ended, never both, never neither, one payment
  and one charge every round. **Switched off as Pay is pressed**: 15 refused before Paystack, 35 paid on a page
  handed out first and refunded in full.
- Money rules (`e2e/lib/invariants.ts`): a booking ended because its home went was never charged or holds one full
  refund, and has no payout; `load/invariants.spec.ts` now also runs the expiry job live and checks that no unpaid
  booking is left on such a home (so, unlike the rest of the checker, it writes: it ends what the job would end).

### The full set, once (`a0002bf`, under `caffeinate -dims`, mains power)

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Harness build | pass |
| Money rules, with the new ones | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50 rounds | **216 passed, 4 skipped, 0 failed, 0 flaky, 1 did not run; exit 1**: one error outside any test (SU8, below) |
| Chaos | 17 passed |
| Other five set-ups | 226 passed, 4 skipped, 0 failed, 0 flaky |
| Removal proofs | **267 held, 2 did not**: 36 and 37 could not be applied (their text had moved, commit 4); re-anchored in `d2bd91e`, and both hold |
| Bundle guard | pass; **desktop search 648 KB of 650** |

**So the run was not clean**, and nothing was re-run to make it so:

- **The Chromium suite exited 1.** `tests/perf/bundle.spec.ts`, "a date-picker file that does not arrive gives Try
  again" (not changed by SU7) left its `page.route` handler fetching a chunk after the test ended; Playwright raised
  "route.fetch: Test ended" outside any test and stopped that worker, and one test was counted "did not run" (all
  221 started; which one was cut short is not recorded: the run's JSON was overwritten by the chaos set). Recorded
  as SU8, with the one-line fix proposed (`page.unrouteAll({ behavior: 'ignoreErrors' })`); not fixed.
- **Proofs 36 and 37** did not run in the full set because their anchors had moved: a mistake in commit 4, fixed in
  `d2bd91e` and both proved holding on their own afterwards. The full set was not run again.

## security-upgrades: the audit items that ship (2026-11-02, branch `security-upgrades`)

Branch `security-upgrades`, from `main` at `2c51a84`, pushed, **not merged**. Everything ran on this MacBook Air on
mains power under `caffeinate -dims`, on the local test stack, built only through the harness; nothing real was
called; no switch or environment variable was set; **the live database was not touched.**

### SU6 bounded, a switched-off home checked, and a clean full run (2026-11-02, `296e810`, `972894d`)

**SU6, option 1 tried first** (wait 1 s inside the change's own request, then mark the home page again, awaited
at the seven call sites). The race test passed 20 of 20, but the original "leaves the home page at once" test
failed 9 of 20 with four in parallel (each time the page right after the answer was a cache HIT with the home in
it), so it did not meet the bar and was reverted. How much slower each action answered with it (median of 8, local
stack, against the same code without the wait):

| Action | Before | With option 1 |
|---|---|---|
| Create a listing (`POST /api/listings`) | 3 ms | 1,012 ms |
| Edit a listing (`PATCH /api/listings/[id]`) | 4 ms | 1,016 ms |
| Add a photo (`POST /api/listings/[id]/photos`) | 6 ms | 1,023 ms |
| Admin holds a listing (`POST /api/admin`) | 3 ms | 1,014 ms |
| Admin clears a hold (`POST /api/admin`) | 3 ms | 1,012 ms |
| Switch a listing off (`DELETE /api/listings/[id]`) | 3 ms | 1,014 ms |
| Admin suspends an account (`POST /api/admin/users`) | 5 ms | 1,009 ms |

**SU6, option 4 landed** (`296e810`): the home page is redrawn every 60 s instead of every 300 s
(`s-maxage=60`). The guarantee is now "usually at once, at most a minute". The original test polls for up to 75 s
and records the time: 20 of 20 passed with four in parallel, 19 at once (0.5-1.4 s, the page load) and one after
62.5 s; the race test left a copy behind in round 8, gone after 64 s. (The first visit after the minute still gets
the old copy while the page is drawn again, so "a minute" is about 60-65 s.) A test that the page is kept at most
60 s is removal proof 262. Money and sign-in code are untouched.

**Extra database reads:** a redraw of the home page runs 3 small listing queries (one per rental type, up to 8 rows
each); nothing else on the page reads on the server. Timed redraws happen only when the page is visited after its
minute: at most 1,440 a day (4,320 queries) instead of 288 (864), so **at most about 3,456 more queries a day,
about 2.4 a minute**, and only if the home page is visited every minute. Redraws after a change are unchanged.

**A switched-off home from an old page** (`972894d`, `tests/journeys/switched-off.spec.ts`, @core, every browser
set-up). What the guest sees:
- pressing a card on a home page drawn before the switch-off: "Listing not found. This listing may have been removed
  or is no longer active." with "Browse all listings"; no dates, no Book button
  (`e2e/.reports/switched-off/*-stale-card.png`). The server refuses a booking: 400 "Listing is not available";
  no booking, no payment;
- a listing page left open: dates chosen, then Instant Book after the switch-off shows "Listing is not available"
  under the price; nothing booked or charged (`*-open-listing-page.png`);
- **SU7 (new, open):** a booking confirmed *before* the switch-off can still be paid for after it: `POST
  /api/payments` answered 200 with a Paystack link. The payment route does not look at the listing. Payment code
  was not changed; the test expects a refusal and is marked `test.fail()` until you decide.

**The full set, once, under `caffeinate -dims` on mains power (`972894d`):**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (lint: 39 warnings, none new, 0 errors); 1,646 tests in each of the six zones |
| Harness build | pass |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **211 passed, 4 skipped, 0 failed, 0 flaky** (SU7's test counted as the expected failure it is marked to be). Peak 26 connections |
| Chaos set | **17 passed** |
| Core set in Firefox, WebKit, tablet, iPhone, Android | **216 passed, 4 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 262 hold** (261 SU5, 262 SU6) |
| Bundle guard | pass. **Desktop search with the map 648 KB of 650.** Phone pages 200-243 KB |

**Clean: no failure and no flaky test anywhere.**

### SU5 fixed; SU6 cause found, fix waiting for a decision (2026-11-02, `ac0d7f3`)

**SU5** (`ac0d7f3`): what each engine writes was checked in Node, Chromium, WebKit and Firefox for every date
format the code uses. Only short month names differ ("Sept" in Node, Chromium and Firefox; "Sep" in WebKit);
numbers in `en-GH` and `en-US` are the same everywhere. `src/lib/dateText.ts` now writes every date from a fixed
table, with the same output as before except "Sep", and every date in `src/` goes through it:

| Where | Drawn by the server too? | Was |
|---|---|---|
| `formatStayDate`: checkout, both dashboards, booking and problem pages, host bookings and calendar, rent schedule, price breakdown, cancel dialog, admin disputes, rent and listing checks | yes (checkout, dashboards) | `en-GH` short months: "Sept" vs "Sep" |
| `formatPayBy`: checkout, guest dashboard, booking page | yes | `en-GB` short months |
| Listing page: host joined, review months | yes | long months (same everywhere, moved for safety) |
| Search: the date summary | yes | `en-GB` short months |
| Admin: exchange rate updated / last fetch | yes (Settings tab from a link) | `toLocaleString()`: the runtime's language and zone. Now "6 Sep 2027, 3:45 pm", UTC from the server, the reader's zone once running |
| Profile, guest payments, host payouts, admin users, verifications and messages, message dates, refund and listing-check wording, blocked-dates message | no (fetched in the browser) | short months or the runtime's zone; now the table (reader's zone kept where it was) |
| Home page cedi prices, wishlist, host bookings total | home page yes | `toLocaleString()` with no locale; now pinned |

Tests: `src/lib/dateText.test.ts` (every month, every format, the six zones of `test:tz` and the process's own,
and a guard that fails on any locale date call in `src/`); `tests/journeys/dates.spec.ts` (@core, every browser
set-up): a stay in September reads "Sep" from the server and in the browser on checkout and both dashboards, with
no React 418. It failed on the old build ("Sept" in the server's copy). Removal proof 261; proof 257 (SU1)
re-anchored on the new 12-hour clock. Both hold.

**SU6: the cause.** In Next's cache (`next/dist/server/lib/incremental-cache`), a page that is kept is stamped
with the moment it is stored (`set()`: `lastModified: Date.now()`), and `revalidatePath('/')` expires only copies
stored before the mark (`areTagsExpired`: `expiredAt > timestamp`). A visit that read the listings just before a
home was switched off, and stored the page just after the switch-off marked it, is therefore kept as fresh. Shown
with a probe (every response for `/` recorded): one test at a time with only visits to `/`, 0 of 15 failed; with
visits and another listing's edits (which keep drawings under way), 4 of 15, each time a cache HIT holding the
switched-off home, put right only by the next mark.

**On `main` (`2c51a84`, Next 16.3.8):** the same code in Next, and the same result: the probe 4 of 15, the suite's
test 2 of 20 with four in parallel. Not caused by the upgrade.

**Tried and dropped:** marking the page again 1 s and 5 s later from `after()`. Next applies every mark made in
`after()` only when all of the request's `after()` work has finished, as one mark, so the 1 s mark landed at 5 s.
A new race test (four lanes: three visitors drawing `/`, a host editing another listing; ten rounds) failed every
time alone on the old code (19 bad rounds in 50) and still failed 3 of 5 runs with this change (3 in 50). Reverted;
the test and the attempt are kept outside the repository for whichever fix is chosen.

**Not run:** the full set. The suite's test for SU6 is still flaky under parallel load, so the run could not be
clean; it waits for the SU6 decision.

### SU1-SU4 fixed, and the full set again (2026-11-02, `f023872`..`c741149`)

On the owner's go-ahead, one commit each, still on this branch and not merged:

1. **SU1** (`f023872`): `formatPayBy` uses `hourCycle: 'h12'` in place of `hour12: true` (which overrides
   `hourCycle`, so it is gone, not kept beside it). New `src/lib/payDeadline.test.ts`: 12:00-12:59 am and pm and
   the hours either side, in the six zones of `test:tz` and in the process's own zone. Proof 257.
2. **SU2** (`0bc322a`): one Prisma client per process in production too. **Why `db.ts` was loaded twice:**
   Turbopack bundles it once for the API routes and once for the pages. A server-first page imports its route's
   `GET` (`lib/serverRead.ts`), so `db.ts` is also compiled into the page layer, under a second module id (843793
   and 761469 in that build). Both copies live in one process and each ran its own top level; `db.ts` shared the
   client through `globalThis` only outside production, so a production server made two clients, two pools. Now
   it is shared in every environment. Tests: `src/lib/security/onePool.test.ts` loads `db.ts` three times as fresh
   modules and fails if a second `PrismaClient` is made; `tests/resilience/one-pool.spec.ts` starts an app server
   with a pool of one, asks it for API routes and server-first pages one after another and counts its
   connections to Postgres (2 on the old build, 1 now). The harness gives each app a pool of 10 (`run.mjs`,
   `--pool` or `E2E_APP_POOL` to change it). Proofs 258, 259.
3. **SU3** (`23db71f`): without WebGL2 the map area says "The map isn't available on this device. The list shows
   the same homes." (no canvas, pins or credits); tested with WebGL2 refused, on desktop and both phones. Proof 260.
4. **SU4** (`c741149`): "1 property found", "Map view · 1 property".

**Connections, full Chromium suite (races at 50 rounds), peak on the test Postgres (limit 60):**

| | Peak | Largest single app server | "Too many clients" |
|---|---|---|---|
| Before the fixes (`84e6764`, second run) | 60 | 33 | yes: 1 failed, 2 flaky; first run 34 failed |
| Before any upgrade (`292958f`) | 56 | 30 | none |
| **After the fixes (`c741149`)** | **25** | **10** (its pool) | **none** |

(The chaos set afterwards takes every free connection on purpose, "no connections left": with 53 taken, 35 of 40
requests were answered 200 and 5 with a plain 500, and both servers mended. Those are the only "too many clients"
lines in the app logs of this run.)

**The full set, under `caffeinate -dims` on mains power:**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass; 1,549 tests in each of the six zones |
| Harness build | pass |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **204 passed, 4 skipped, 1 flaky**: "a home switched off leaves the home page at once" failed once and passed on retry (SU6) |
| Chaos set | 17 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | **199 passed, 4 skipped, 2 flaky**: the crawl as host on tablet and iPhone, React error 418 on the host dashboard, passed on retry (SU5) |
| Removal proofs | **all 260 hold** (257-260 new) |
| Bundle guard | pass. Desktop search with the map **648 KB of 650** (647 before; the WebGL2 check and message are 1 KB). Phone pages 200-243 KB |

**So the run was not clean.** Nothing was re-run to make it pass. No failure was about connections. The three
flaky tests are two older faults, both new findings:

- **SU5**: a September stay date is "Sept" from the server (Node's ICU 75, `en-GH`) and "Sep" in Safari, so a
  server-first page with a September date is drawn twice in Safari. A diagnostic (24 loads of the host dashboard
  in the tablet and iPhone set-ups) reproduced 418 three times, each with a September booking; the crawl's dates
  are random, which is why it passed on retry and in earlier runs.
- **SU6**: the home-page test fails only alongside other home-page renders: 0 of 20 one at a time, 2 of 20 with
  four in parallel. A render that read the listings before the switch-off appears to be kept after
  `revalidatePath('/')`. In real use a switched-off home could stay in the hero until the 5-minute refresh.

Neither is fixed: both need your go-ahead.

### What changed, in order (one commit each)

1. **Map tests on maplibre 5** (`292958f`): `tests/journeys/map.spec.ts` (pins, popup and its link, clusters that
   zoom apart or list, Enter and Escape, no map or worker error), written and passing before the upgrade. Before
   screenshots in `e2e/.reports/map-shots/v5-*`.
2. **Next 16.3.8 → 16.4.3**, pinned, with `eslint-config-next` (`2e3c7dd`). The three October advisories are fixed
   from 16.4.1. None reached this app: `dangerouslyAllowSVG` is not set and sharp was already 0.35.5; there is no
   `use cache`; there is no Server Action (`'use server'` appears nowhere: every write is an API route). 16.4.4 (out
   on 2 November) was read first: bug fixes only, no advisory, so 16.4.3 is kept. The version test now requires 16.4
   with patch 1 or later; proofs 48 and 49 are re-anchored on the new version line.
3. **maplibre-gl 5.24 → 6.16, react-map-gl 8.1.1 → 8.1.3** (`8eea4f3`). The advisory was in `DOM.sanitize`, used
   only by maplibre's attribution control, which was off. Two changes were needed: maplibre 6 runs its worker from
   a file of its own, which `ListingsMap` now hands to the bundler and passes as `workerUrl`; and maplibre 6 removed
   the internal `map.transform` that react-map-gl 8.1.1 read (the map never finished loading), which 8.1.3 no longer
   uses. Popups, markers, clustering and the `.map-popup` CSS needed nothing. The bundle guard now counts the
   worker's bytes. After screenshots: `e2e/.reports/map-shots/v6-*`.
4. **@sentry/nextjs 10.72 → 10.78** (`c3a04a0`). The advisory needed a tunnel route and a webpack build; there is
   neither here. The hand-built browser client is unchanged and still reports errors and unhandled rejections,
   scrubbed (`tests/resilience/browser-errors.spec.ts`; proofs 77 and 248). Every page is 2 KB smaller.
5. **The map's credits** (`84e6764`): "© MapTiler © OpenStreetMap contributors", as MapTiler's terms ask; our own
   small line (not maplibre's control), bottom left, clear of the zoom buttons, both links to the copyright pages,
   in a new tab; a test checks text, links, size and position. Screenshots: `e2e/.reports/map-shots/attr-*`.

`npm audit`: 60 → **56**; nothing high or critical in anything that ships. Left in what ships: a moderate on
@sentry/nextjs from the OpenTelemetry packages it uses on the server (no fixed release, not even 11.x; server
tracing is off, so the database-user advisory never applies).

### Speed

Real throttling, before → after, mobile LCP: 1.58-1.74 → 1.61-1.76 s on all seven pages, TBT at most 33 ms, CLS 0:
within the run-to-run spread. Script on first load: 2-6 KB less on every page. Desktop search with the map:
484 → **647 KB of its 650 KB cap**, all of it maplibre 6 (its worker, 145 KB, used to be inside its script and is
now a file of its own, counted since this branch). Full table: `e2e/load/results/security-upgrades.md`.

### Verification (`84e6764`)

Quick set after each commit (lint, type check, `test:tz`, harness build, smoke, bundle guard) plus each commit's
own tests: all passed. (On the Next commit the server-first test first failed at 11:3x UTC and passed after 12:00:
the pay-by formatter, unchanged by this branch, writes 12 o'clock times differently on the server; SU1 below.) The full set once at the end:

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass; 1,476 tests in each time zone |
| Harness build | pass, logged (`e2e/.reports/security-upgrades/full/build.log`) |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **first run: 165 passed, 34 failed, 4 flaky; every one "too many clients" on the test Postgres (SU2). Second run: 200 passed, 1 failed, 2 flaky** (two race tests with 500s from the same cause, and "a home switched off leaves the home page" timing out). The same suite on `292958f` (before any upgrade): 202 passed, peak 56 connections; with the upgrades the peak was 60, the limit. |
| Chaos set | 17 passed, both runs |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 197 passed, 3 skipped (the map in Firefox), none flaky |
| Removal proofs (restore-safe runner) | **all 256 hold**; 48 and 49 re-anchored on the Next version line |

So the full set did not come back clean. The failures are the test database running out of connections, which
the suite on the commit before the upgrades did not quite do (56 of 60). The cause is older than this branch (SU2):
each app server holds more than one Prisma pool. Reverting upgrades one at a time would not separate a 4-connection
difference from run-to-run noise; the fix that would is SU2's, which needs your go-ahead.

### Found along the way (FINDINGS.md, SU1-SU4; fixed afterwards, see the top of this section)

- **SU1**: "Pay by 0:34 pm": a deadline in the 12 o'clock hour is written with a 0-11 clock by the server. One line.
- **SU2**: two Prisma pools per app server (production: two connections per instance, not one); the test database
  runs out. Proposed: keep the client on `globalThis` in production too, and an explicit pool size in the harness.
- **SU3**: without WebGL2 the map area is empty, with no message (maplibre 5 fell back to WebGL1). Screenshots:
  `e2e/.reports/map-shots/v5-nowebgl2.png` (map and pins) and `v6-nowebgl2.png` (empty).
- **SU4**: "1 properties found".
- A pointer press on a pin does not move the focus (the map stops the default on its markers), so Escape closes a
  popup only when it was opened from the keyboard; the close button and a tap on the map close it otherwise.

### Dev-only items, not upgraded (owner's decision)

| Package | Fix | Major | Clears | Why not now |
|---|---|---|---|---|
| vitest 3.2.7 | 4.1.12 | yes | vitest, vite, tinypool, @vitest/mocker (2 critical, 1 high, 1 moderate) | test runner only; may need config changes across 1,476 tests |
| prisma CLI 6.19 | 7.10 | yes | prisma, @prisma/config, deepmerge-ts (3 high) | the CLI and `@prisma/client` move together: a server change for every query. Its own project after launch |
| lighthouse 12.8.2 | 13.6 | yes | 9 high and most moderates (it carries Sentry 9) | the G5 speed figures would need a new baseline |
| eslint 9 | 10.14 | yes | 1 | the rest follow `eslint-config-next` |

### Not checked

- Real MapTiler tiles (the harness's style is a plain background), real phones, a real Vercel build.
- A real phone without WebGL2: simulated by making the browser refuse it.
- Real Sentry: a report from the browser after the upgrade, with its source maps.

## mobile-speed: G5, pages that come with their data (2026-11-01/02, branch `mobile-speed`)

Branch `mobile-speed`, from `main` at `38a9975`, not merged. Everything ran on this MacBook Air on mains power on
the local test stack, built only through the harness; nothing real was called; no switch was set in `.env`; no
email, SMS, Paystack, Arkesel or Sentry upload; **the live database was not touched.** The home page's code was
left alone (its redesign is next): its figures moved only with the shared changes.

### What changed, in order (one commit each)

1. **Guards** (`4c3da58`): a script budget per page (`tests/perf/bundle.spec.ts`: 350 KB compressed on first
   load, the router's prefetching of linked pages left out; desktop search with its map 650 KB; map code only on
   desktop search; date-picker code only once a date field is opened), browser errors reaching Sentry scrubbed
   (`tests/resilience/browser-errors.spec.ts`: an error and an unhandled rejection), and no server code in any
   client file (`src/lib/security/clientImports.test.ts`).
2. **Admin's Prisma leak** (`6dcaf89`): two constants moved to `lib/exchangeRateShared.ts`.
3. **The map** (`f214627`): fetched on a phone only when "Map" is pressed (it had loaded, hidden, on every phone:
   280 KB), on desktop once the list has drawn, same-size skeleton, "Try again" if the file fails
   (`lib/useOnDemand.ts`). Its stylesheet already loaded only with it.
4. **The date picker** (`a0490c5`): on the listing page, fetched when a date field is opened
   (`components/ui/LazyDatePicker.tsx`); the same input until then.
5. **Sentry** (`7b3b164`): `compiler.define` was not used: Next applies it to the server and edge builds too,
   which stay unchanged. The browser client is built from the same parts minus tracing; `...SCRUBBING` is word
   for word as before; `onRouterTransitionStart` is gone (Sentry's build prints a notice about it: it feeds
   navigation tracing only). About 42 KB less on every page.
   **Found on the way (G6 follow-up, `97c2589`):** the chunk guard fetched and ran Next's `nomodule` polyfills
   (about 40 KB) on every page view; it now leaves them alone.
6. **Server-first pages** (`afb52c4` checkout, `8f40bc5` guest dashboard, `81de7c5` host dashboard, `986cd53`
   listing, `a9b47e9` search, `c55c4f4` admin): each `page.tsx` calls the API route's own `GET` in the same
   process for the request being answered (`lib/serverRead.ts`), so the data and its checks are those the browser
   would get, and only a 200 is used. With no answer within 3 s the page fetches in the browser as before (tries,
   Try again, G1's 401 rule). The notices above the dashboards come with them too, which ends the host dashboard's
   layout shift. Then `0e99928`: the client pages had Suspense boundaries of their own, and React threw the
   server's HTML away and drew checkout again once its JavaScript arrived (on every load); they are gone, with a
   test that each page keeps the element the server sent.
7. **Inlined stylesheets** (`669ecfc`, reverted in `699f8c7`): kept reverted by the owner's decision. An open
   option to revisit after the live Lighthouse run; see "For the owner" below.
8. **Logo font** (`b175444`, reverted in `89850c0` by the owner's decision): Unbounded was kept for "fie." and no
   longer preloaded. No measurable gain beyond the run-to-run spread, and the logo was drawn in the fallback at
   first paint and swapped about 0.5 s later. It is preloaded again, as on `main` before this branch; home and
   search measured after the revert are in `results/g5-final.md`.
9. **Packages** (`a027977`): the 7 unused packages removed, 2 type packages moved to devDependencies.

The commit `39ca97f` ("measuring after the Sentry change") carried half-made server-first files by mistake and did
not build on its own; `2fe83a5` puts them back and the server-first commits follow it. Nothing was force-pushed.

### Before and after against the budgets

Lighthouse 12.8.2 as in Stage B (simulated slow 4G, CPU 4x, median of 5 runs). "JS first load, phone" is the
bundle guard's count (the baseline built from `38a9975` through the harness).

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.6 s → 3.3 s **over** | 3.6 s → 3.3 s **over** | 0.000 → 0.000 | 41 → 17 ms | 327 → 247 KB | 320 → 261 KB | 0.6 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 4.5 s → 3.1 s **over** | 7.3 s → 3.2 s **over** | 0.000 → 0.000 | 193 → 18 ms | 565 → 204 KB | 604 → 279 KB | 1.5 s → 0.7 s |
| listing | 4.2 s → 3.4 s **over** | 4.2 s → 3.5 s **over** | 0.038 → 0.000 | 78 → 28 ms | 347 → 223 KB | 354 → 299 KB | 0.9 s → 0.6 s |
| checkout | 4.1 s → 2.4 s | 4.1 s → 2.4 s | 0.077 → 0.000 | 67 → 31 ms | 286 → 206 KB | 320 → 280 KB | 0.9 s → 0.5 s |
| guest dashboard | 3.8 s → 3.2 s **over** | 4.2 s → 2.6 s **over** | 0.000 → 0.000 | 63 → 32 ms | 304 → 224 KB | 361 → 321 KB | 0.8 s → 0.6 s |
| host dashboard | 4.4 s → 2.4 s | 3.3 s → 3.4 s **over** | 0.176 → 0.000 | 71 → 19 ms | 300 → 220 KB | 336 → 296 KB | 1.0 s → 0.5 s |
| admin | 4.4 s → 3.1 s **over** | 4.8 s → 2.4 s | 0.000 → 0.000 | 64 → 31 ms | 309 → 212 KB | 343 → 287 KB | 1.0 s → 0.5 s |


Simulated LCP for the server-first pages lands at about 2.4 or about 3.1 s from run to run: the simulation counts
every script that started before the content was painted, even ones that do not hold it up; in Lighthouse's own
recording, LCP is the first paint. So the same pages were measured with the browser really slowed to the same line
and CPU (`E2E_LH_THROTTLING=devtools`, empty database, 3 runs):

| Page | Mobile LCP | Mobile CLS | Mobile TBT | Desktop LCP |
|---|---|---|---|---|
| home (unchanged, redesign pending) | 1.57 → 1.55 s | 0.000 → 0.000 | 62 → 40 ms | 0.09 → 0.08 s |
| search with map | 5.34 → 1.60 s | 0.000 → 0.000 | 143 → 15 ms | 0.17 → 0.16 s |
| listing | 5.04 → 1.63 s | 0.038 → 0.000 | 62 → 15 ms | 0.20 → 0.12 s |
| checkout | 3.90 → 1.65 s | 0.077 → 0.000 | 52 → 22 ms | 0.19 → 0.13 s |
| guest dashboard | 3.99 → 1.67 s | 0.000 → 0.000 | 48 → 24 ms | 0.16 → 0.12 s |
| host dashboard | 4.59 → 1.66 s | 0.123 → 0.000 | 50 → 23 ms | 0.22 → 0.15 s |
| admin | 4.03 → 1.66 s | 0.000 → 0.000 | 50 → 22 ms | 0.19 → 0.11 s |

The harness's photos are small generated ones, so the image pages (home, search, listing) do not carry a real
photo's weight in either table. Results per step: `e2e/load/results/g5-*.md`.

### Verification on the final code (`414ae03`, under `caffeinate -dims`, mains power)

| Check | Result |
|---|---|
| Lint, type check | pass (warnings only, all from before) |
| `npm run test:tz` (six time zones) | pass, 1,476 tests each |
| Full harness build | pass, logged (`e2e/.reports/mobile-speed/final/build.log`) |
| Chromium suite, races at 50 rounds | 199 passed, 4 skipped (the opt-in contrast measurement), none flaky |
| Chaos set (now with the server-first fallbacks) | 17 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 189 passed, 1 skipped (the map in Firefox), none flaky |
| Resilience and session sets, accessibility scan | in the Chromium suite: pass, 0 accessibility failures |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Removal proofs (restore-safe runner) | **all 256 hold**; 245-256 are new (245 admin import, 246 map on phones, 247 eager date picker, 248 browser scrubbing end to end, 249 chunk guard and `nomodule`, 250-255 each page's server data, 256 no Suspense boundary of their own). 246 and 245 were re-anchored when their code moved to `SearchClient.tsx` and `AdminClient.tsx`; none of 1-244 needed it. |

### For the owner

- **Inlined stylesheets** were reverted because the agreed measure (the simulated runs) got worse: LCP up on 5 of
  7 pages and TBT up on all (listing 259 ms). With real throttling the same change made every page 0.2 to 0.9 s
  faster (checkout 1.67 → 0.81 s). Decision: it stays reverted for now, an open option to revisit once
  Lighthouse has been run against the live site; `669ecfc` has the change (one setting in `next.config.ts`).
- The logo font change showed no gain in either measure and cost a flash of the plain logo: reverted (`89850c0`).
- `npm audit` reports 60 issues now, before and after the package change (CLAUDE.md says 12: its list has grown).
- Seen once, not reproduced in 6 targeted runs: React error 418 (text differed between server and browser) on the
  host dashboard in the iPhone set-up during a crawl. React recovers by drawing that part again.

### Not checked

- Real phones, real networks, Vercel and Supabase's real latency: the server now waits for its reads (up to 3 s)
  before sending these pages.
- Real Sentry: that a report from the hand-built client shows a readable stack trace from the uploaded source maps.
- Real MapTiler tiles and real photos (the harness answers with a blank style and small photos).

## fix-perf-1: fixes and capacity (2026-10-21, branch `fix-perf-1`)

Branch `fix-perf-1`, from `e2e-performance`, not merged. Everything ran on this MacBook Air on the local test
stack; nothing real was called; no switch was set in `.env`; no email or SMS was sent; no Paystack call was made.
**The live database was not changed:** the Supabase project could not be reached (see G13 below).

### What was fixed

G15, G6, G1, G7, G2, G11, G4, G9, G8 and G10, one commit each; the capacity work; the Vercel region and the
production database settings. Each, with its tests, is in `FINDINGS.md` ("Second go: where things stand").
Deferred by the owner and not touched: G12, G14, G3, G16 and the JavaScript reduction (G5).

### Capacity: before and after

Production-like set-up as in Stage C: 4 app processes, a pool of 5 each, Postgres at 60 connections, 30-80 ms
added to every database round trip, the same k6 mix and the same 5,000-home load set. "Before" was run again
today on the commit before the capacity work (`abf97c2`), so both sides share the machine and the day; it
matched Stage C closely. Results: `e2e/.reports/fixperf/{before,after,before-errors,after-errors}`, summarised by
`node e2e/load/summarise.mjs <folders>`. Browse and write: p50 / p95 / p99 in ms.

| Scenario | Req/s | Browse | Write | Failed | 5xx / no answer | Bookings / payments |
|---|---|---|---|---|---|---|
| average, before | 25.7 | 376 / 1,064 / 1,591 | 2,308 / 3,574 / 4,837 | 0.00% | 0 / 0 | 184 / 53 |
| average, after | 29.5 | 285 / **613** / 820 | 1,406 / **2,457** / 3,408 | 0.00% | 0 / 0 | 240 / 64 |
| ramp-up, before | 31.4 | 1,278 / 4,618 / 8,247 | 7,987 / 24,177 / 25,186 | 0.61% | 187 / 0 | 188 / 55 |
| ramp-up, after | 43.8 | 325 / **3,568** / 5,998 | 4,815 / **10,354** / 11,151 | 0.50% | 211 / 0 | 300 / 82 |
| spike, before | 36.9 | 775 / 10,417 / 10,674 | 10,004 / 30,002 / 30,002 | 10.38% | 1,853 / 208 | 88 / 14 |
| spike, after | 44.7 | 324 / 10,142 / 17,760 | 14,797 / 28,976 / 29,879 | **4.30%** | 1,039 / 5 | 109 / 29 |
| breakpoint (stops on latency), before | **38.4 at the stop** | 544 / 2,371 / 2,922 | 2,865 / 8,308 / 10,958 | 0.06% | 1 / 0 | 17 / 2 |
| breakpoint (stops on latency), after | **56.2 at the stop** | 269 / 1,665 / 2,318 | 1,687 / 5,224 / 7,931 | 0.00% | 0 / 0 | 20 / 10 |
| breakpoint (stops on errors), before | **48.4 at the stop** | 1,603 / 9,884 / 10,459 | 13,591 / 30,001 / 30,001 | 2.23% | 61 / 44 | 23 / 2 |
| breakpoint (stops on errors), after | **86.9 at the stop** | 297 / 10,003 / 10,296 | 8,971 / 28,603 / 29,548 | 2.70% | 256 / 0 | 30 / 11 |

"At the stop": requests served per second in the 30 s before k6 stopped the run (latency: browse p95 over 2 s or
write p95 over 5 s; errors: more than 2% failed). Req/s in the other rows is the whole run's average.

- **The breaking point moved from about 38 to about 56 requests a second on latency (+46%), and from about 48 to
  about 87 on errors (+80%).** Average-load p95 fell 42% for browsing and 31% for writes; the spike's failures
  fell from 10.4% to 4.3%, and requests with no answer at all from 208 to 5.
- **What still breaks first: the connection pool.** The errors left are Prisma P2024 (no connection within 10 s)
  and P2028 (a transaction could not start in time), most of them booking creation, which holds a serializable
  transaction. At the top of the ramp-up (200 visitors, above the breaking point) 41% of booking attempts failed
  (before: 50%), while 300 bookings succeeded (before: 188).
- **Money and date rules: clean before and after every run, 20 checks** (`e2e/.reports/invariants/fixperf-*`).
- No safety check, rate limit or money rule was changed for speed. One 429 in the average run and one in the
  ramp-up are the rate limits doing their job.
- App memory peaked at 268 MB a process (before: 229 MB), CPU at 176% of one core over the four (before: 128%):
  the servers do more work because they wait less. Database connections peaked at 33 in both.

One request at a time, through the 30-80 ms proxy (`e2e/.reports/stageB/server-timing-fixperf-{before,after}.json`),
p50 in ms; each round trip to the database costs about 300 ms on this proxy:

| Route | Before | After |
|---|---|---|
| a listing (`GET /api/listings/:id`) | 937 | 305 |
| one booking, as checkout reads it | 1,895 | 602 |
| a guest's bookings (dashboard) | 1,625 | 641 |
| a guest's messages | 1,358 | 621 |
| search (`limit=50`) | 581 | 348 |
| search with dates | 594 | 381 |
| a listing's reviews | 555 | 314 |
| the session check | 425 | 293 |
| exchange rate, homes per region | 298, 315 | 1, 1 (kept 30 s) |
| sign-in (bcrypt) | 2,067 | 1,174 |
| booking a home | 1,990 | 1,459 |
| starting a payment | 2,515 | 1,589 |

What changed (commit `974c70e`): Prisma's `relationJoins`, so a read with relations is one query; the public
exchange rate and homes per region kept 30 s per process (charges, refunds and payouts still read the rate from
the database); the booking transaction's three limit counts made one read; "already paid" and "already open" one
read inside the payment claim; sign-in's lookup alongside the attempt being written, and the session made
alongside the counter being cleared; a booking's digital address read with the booking; a listing's viewer looked
up alongside it.

Not done, and worth the next step: serving the last kept answer when a refresh of a kept read fails (in the
spike, some exchange-rate and region-count requests failed together when one refresh timed out); keeping the
booking transaction's connection for less time again (the conflict and blocked-date checks are still two reads);
and the payouts-due queries (G12, deferred).

### Bad networks after G6 (Stage B profiles, Chromium, median of 3)

| Profile | Home | Search | Listing | Checkout |
|---|---|---|---|---|
| stalls (5%) and resets (2%), Stage B | never | never | never | never |
| stalls and resets, after G6 | 8.6 s | 0.9 s | 0.9 s | 0.9 s |
| slow 4G, Stage B → after G6 | 3.8 → 4.0 s | 3.5 → 3.9 s | 4.5 → 5.0 s | 4.0 → 4.4 s |
| 3G, Stage B → after G6 | 5.3 → 5.5 s | 4.7 → 4.7 s | 5.7 → 6.2 s | 5.2 → 5.2 s |
| low-end Android, 3G, CPU 6x, Stage B → after G6 | 5.3 → 5.5 s | 4.8 → 5.3 s | 5.9 → 6.3 s | 5.3 → 5.3 s |

The first measurement after G6 was 0.3-0.5 s slower than Stage B on slow 4G (first paint the same, JavaScript
only 1-7 KB more): the guard was a plain inline script after the stylesheets, which held the page until they had
loaded. As a module script (`907df9a`) it does not. Final build, slow 4G: home 3.77 s, search 3.44 s, listing
4.45 s, checkout 3.95 s (Stage B: 3.77, 3.47, 4.46, 3.99). Stalls and resets, final build: home 0.7 s, search 0.9 s,
listing 0.9 s, checkout 0.9 s, no page stuck. Lighthouse on the final build (mobile, empty database, 3 runs): search
LCP 6.2 → 4.4 s (G9), other pages within 0.15 s of Stage B; JavaScript 1-7 KB more per page (G5 deferred).

The full suite also found two faults in the first G6 code, fixed in `d9861a7`: the session check returned on a 401
without reading the answer (the browser kept the request open, so pages never went quiet), and the guard's
page-load check fetched and ran a second time a chunk the app had added late. Both have unit tests and proofs.

### G13: the indexes were not applied

The live Supabase project could not be reached on 2026-10-21: the direct host and the project's own address have
no DNS record, and the pooler answers "tenant/user not found" on both ports. That is how a paused free-tier
project looks (the last work on it was 2026-10-14, seven days before). Nothing was run on it, and the schema was
not changed, so nothing that depends on the indexes was shipped. Ready in `.scratch/idx/`:

- `statements.sql`: the 16 approved statements (the 17 less `Booking_paid_checkIn_idx`).
- `apply.cjs`: dry run by default; with `--confirm` it runs one statement at a time, skips an index that is
  already there and valid, takes row counts and hashes of the nine tables before and after each, checks the
  index is valid and ready, and stops at the first surprise. Log in `apply-log.json`.
- `undo.sql`: one `DROP INDEX CONCURRENTLY IF EXISTS` per index.
- `schema-indexes.md`: the 15 `@@index` lines for `prisma/schema.prisma`, and the `migrate diff` to run.

One needs a decision: `Booking_live_checkOut_idx` is a partial index, which Prisma 6.19 cannot state in the
schema (`prisma validate` refuses `where:`), so `migrate diff` will always show it and `prisma db push` would drop
it. Keep it partial and record it in `prisma/constraints.sql` with that warning, or use the full index
`@@index([checkOut, checkIn, listingId])`, which the schema can hold.

### Final checks

| Check | Result |
|---|---|
| Lint | 0 errors (39 warnings, as before: unused names and `<img>` elsewhere) |
| Type check | passes |
| Unit tests in six time zones (`npm run test:tz`) | 1,468 passed in each, on the code after the capacity commit. Four tests were added after (1,472); their files passed alone. **A clean full run on the final code was not obtained:** the Mac was asleep on battery, and three runs each lost a different 2-13 timing tests to 5-second timeouts (one file took 736 s that normally takes seconds). Rerun `npm run test:tz` on mains power |
| Full suite, Chromium, final code | 186 passed, 4 skipped (the opt-in contrast measurement), none flaky; crash tests alone: 10 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 199 passed, 1 skipped (the map in Firefox), on `bb59a8e`'s code less the last change (the guard as a module); the resilience and session tests were then run twice in all six set-ups on the final code: 156 passed. **The full core-set rerun on the final code was not completed**: the Mac went to sleep on battery twice during it (tests taking 8-17 minutes each); its partial logs are `fixperf/browsers-final*.log` and do not count |
| Races at 50 rounds, twice | 31 passed, 31 passed (G15 included: 0 second payments) |
| Removal proofs, one pass under caffeinate | **244 of 244 hold**, tree clean after. (The first pass found 2 proofs, 50 and 115, whose text the capacity commit had rewritten; fixed in `bb59a8e`, then the whole pass was run again) |
| Full production build | passes, built through the harness (`node e2e/run.mjs build`) with the fake environment: `npm run build` with `.env` would upload source maps to Sentry, because `SENTRY_AUTH_TOKEN` is set there |
| Money and date rules | clean after every test and before and after every load run |

Also: during the final checks a command meant to compare lint counts restored the old branch's files over the
working tree (`git checkout e2e-performance -- .`) and stashed the uncommitted FINDINGS draft. Everything was
committed, so the tree was restored from `HEAD` at once and the draft taken back from the stash; `git status`
and the diff against `HEAD` were checked clean. Nothing was lost.

---

## Second go: final report (2026-10-16)

Branch `e2e-performance`, not merged. Everything ran on this MacBook Air against the local test stack (production build, local Postgres, the fakes and the guards); nothing real was touched; no switch was set in `.env`; no real email or SMS was sent. Nothing under `src/` was changed. Before Stage A the post-merge run on `main` was repeated in full and passed (build, smoke 7/7, 220/220 removal proofs, build, smoke 7/7, tree clean).

### Pass / fail by area

| Area | Result |
|---|---|
| WebKit log-in through the form (https front) | pass: the 18 skipped tests run and pass |
| New browser journeys (6, all six browser set-ups) | pass |
| Chromium suite | pass (168 passed, 4 skipped); one run had one flaky test each time (the two-tab checkout, which led to G15; a rent race whose test picked the 31st of a month, fixed in the test) |
| Other browsers | pass (138 passed, 1 skipped, 1 flaky: G3) |
| Lighthouse budgets, mobile | **fail** on LCP for every page; pass on CLS and TBT; JS over on search, guest dashboard, listing |
| Lighthouse, desktop | pass |
| Bad networks and slow phones | usable in 3.5-5.9 s on slow 4G / 3G; **fail** with lost requests (G6) |
| Double submission, offline at Pay, lost answers | pass, except a lost answer to Book (G7) |
| Page to page | pass (70-170 ms, no shift, no reloads); scroll position lost on back (G8) |
| Server timing | pass for guest and host routes (p95 under 45 ms); admin overview, Verifications and the payout job slow at volume (G12) |
| Load: average, soak | pass (0 errors, no drift, no leak) |
| Load: ramp-up, spike, breakpoint | thresholds crossed at about 43-45 requests a second; recovers by itself |
| Money and date rules | **held after every test and every load scenario** |

### Findings of the second go, ranked

- **High:** G6 (one failed request leaves the page stuck), G15 (a second payment opened for a booking just paid), G2 (search by city finds almost nothing once there are more than 50 homes).
- **Medium:** G1 (one failed session check signs a guest out), G5 (mobile LCP over budget everywhere), G7 (lost answer to Book), G11 (a short stay's booking page is linked nowhere in the app), G12 (payouts-due queries read all history), G13 (unindexed foreign keys).
- **Low:** G3 (WebKit search flake, not confirmed), G4 (full-size thumbnails), G8 (scroll lost on back), G9 (lazy images above the fold), G10 (home page cached an hour), G14 (sign-in CPU), G16 (more connections than the pool once, not confirmed).

Each, with how to reproduce it, is in `FINDINGS.md`. **Nothing is fixed under `src/`: every one waits for your decision.**

### Fixed in test code only (already done)

The https front and its redirect handling; the WebKit console filter for the fake Sentry address; the admin card pins in the new journeys; the rent journey's check (it now checks the next month is offered); the date helper in `races/rent.spec.ts` (the 29th-31st); the removal-proof runner (journalled, resumable, restores on any stop); and harness bugs in my own stage scripts (the stack started in the foreground, the latency proxy reordering bytes, the sampler not stopping, zsh taking the scenario list as one word, selectors in the conditions spec). Two new tests mark known faults with `test.fail()`: G1 (`tests/resilience/session.spec.ts`) and G15 (`tests/races/bookings.spec.ts`).

### Needs your decision

Every G finding; the proposed indexes; the payouts-due design (G12); the search fix (G2: the API already accepts `city`); the sign-in hashing cost; the pool and region settings; whether per-address limits suit shared mobile addresses.

### Not tested, and why

- Real Supabase, Supavisor, Vercel, Paystack, Resend, Arkesel, MapTiler, Sentry: never touched, by the rules. Their behaviour is stood in for by the fakes and the latency proxy, which cannot reproduce Supavisor's pooling, the real network, TLS to the database, serverless instances, cold starts or CDN caching.
- Map tiles: MapTiler is answered with a blank style, so map tile downloads and drawing cost are not in any number.
- Real phones and real mobile networks: approximated with Chrome's throttling (Chromium only; WebKit and Firefox cannot be throttled this way).
- A load generator on separate hardware: k6 shared this Mac with the servers.
- The money flows under load beyond instant booking and card payment: refunds, payouts, disputes and rent reminders were not in the load mix (they are covered by the race and journey tests).
- Lighthouse on pages behind sign-in uses a session cookie added to every request; it does not include the time to log in.
- Accessibility, security and unit tests were not rerun in this go except as part of the Chromium suite; the removal proofs were run on `main` before Stage A.
- Shared mobile carrier addresses (CGNAT) against the per-address rate limits.

---

## Second go, Stage A: the gaps from the first go (2026-10-15, branch `e2e-performance`)

Before starting, the post-merge run on `main` (`8e0bf14`) was repeated in full under `caffeinate`: build passed, smoke 7/7, all 220 removal proofs held in one pass (the tree clean after each), build passed, smoke 7/7, `git status` clean. The first attempt had stopped at proof 85 of 220 and left that proof's edit in `src/lib/exchangeRate.ts`; the runner is now `e2e/scripts/removal-proofs.mjs`, which journals originals to disk, restores on exit and on signals, repairs a killed run on the next start and resumes (`--resume`).

Machine: MacBook Air (Mac16,12), Apple M4, 10 cores, 16 GB, no fan; on mains power; 36 GB free.

| Run | Result |
|---|---|
| https front for WebKit | `https://localhost:3443`, throwaway certificate accepted only by the webkit, tablet and iphone projects |
| The 18 tests skipped in WebKit for the Secure cookie (6 in each of webkit, tablet, iphone) | all run, all pass. The suspended log-in test is now in the core set too (3 more) |
| New browser journeys (`tests/journeys/clicked.spec.ts`): listing in six steps with two photos, ID sent and an admin's Reject then Approve, the "address and photos checked" form, suspend and restore from the Users tab, the payout method form, the second month's rent paid from the booking page | 6 of 6 in Chromium, 30 of 30 repeated five times, and in all six browser set-ups |
| Everything in Chromium | 169 passed (4 skipped: the opt-in contrast measurement) |
| Crashes and the database, alone | 10 passed |
| Core set in Firefox, WebKit, tablet, iPhone and Android | 138 passed, 1 skipped (the map in Firefox), 1 flaky: "search by city" on the tablet (G3) |
| New findings | G1 (Medium), G2 (High), G3 (Low, not confirmed); see `FINDINGS.md` |

---

## Second go, Stage B: performance (2026-10-15, branch `e2e-performance`)

Chromium, production build, this MacBook Air. Machine at the start: 36 GB free, on mains power, no thermal or performance warning. Results in `e2e/.reports/stageB/`.

### B1. The load set

`e2e/load/seed.sql`: 20,000 users, 5,000 listings, 50,000 bookings, 200,000 blocked dates, 100,000 messages, 55,814 payments, 29,600 rent instalments, 47,495 payouts, 17,087 reviews, 30,000 wishlist entries. Set-based SQL, "random" values are hashes of each row's key so a rebuild is the same, dates counted from the day it is seeded, all ids `load_`. **Seeding takes 11-12 s, ANALYZE 1.6 s, 264 MB.** The money and date rules hold over the whole seeded database. Removing the set takes 238 s, against 11 s to make it: deleting bookings and users checks unindexed columns (see G13).

### B2. Lighthouse 12.8.2 against the budgets (mobile: simulated slow 4G, CPU 4x; median of 5 runs, seeded database)

| Page | LCP ≤ 2.5 s | CLS ≤ 0.1 | TBT ≤ 200 ms | JS ≤ 350 KB | of which map | Score | Empty DB: LCP / score |
|---|---|---|---|---|---|---|---|
| home | 3.6 s (**over**) | 0.000 (pass) | 30 ms (pass) | 318 KB (pass) | 0 KB | 91 | 3.5 s / 91 |
| search with map | 7.1 s (**over**) | 0.000 (pass) | 178 ms (pass) | 602 KB (**over**) | 282 KB | 74 | 6.2 s / 77 |
| listing | 4.2 s (**over**) | 0.038 (pass) | 63 ms (pass) | 353 KB (**over**) | 0 KB | 86 | 4.2 s / 86 |
| checkout | 4.1 s (**over**) | 0.077 (pass) | 64 ms (pass) | 313 KB (pass) | 0 KB | 86 | 4.1 s / 86 |
| guest dashboard | 3.8 s (**over**) | 0.000 (pass) | 63 ms (pass) | 356 KB (**over**) | 0 KB | 88 | 3.9 s / 88 |
| host dashboard | 3.3 s (**over**) | 0.062 (pass) | 62 ms (pass) | 330 KB (pass) | 0 KB | 92 | 4.4 s / 85 |
| admin | 4.2 s (**over**) | 0.000 (pass) | 58 ms (pass) | 342 KB (pass) | 0 KB | 85 | 4.1 s / 86 |

Desktop (LCP / score): home 0.6 s / 100; search with map 1.5 s / 95; listing 0.9 s / 99; checkout 0.9 s / 99; guest dashboard 1.2 s / 98; host dashboard 1.0 s / 99; admin 0.9 s / 99. All within budget on desktop.

- **LCP is over budget on every page on mobile.** CLS and TBT are within budget everywhere. JS is over on search (602 KB), the guest dashboard (356) and a listing (353).
- Why: about 300 KB of JavaScript every page loads before it can draw its data, then the data is fetched from the browser. The LCP element on checkout, the dashboards and admin is text that appears only after JS + an API call. Biggest shared pieces: the Sentry browser SDK chunk (134 KB, with tracing code although tracing is off; about 63 KB of it unused), react-datepicker (46 KB) loaded on every page, the framework (44 KB). Two render-blocking stylesheets cost about 300 ms on slow 4G. Three font files, 63 KB.
- **The map library is not loaded on pages without a map** (0 KB on all of them). On search it is 282 KB of the 602 KB; 190 KB of it is unused at first paint.
- Search's LCP is the first listing card's photo, which is `loading="lazy"` although it is above the fold.
- Checkout and both dashboards download each listing photo full size (1200 px, 120 KB) for an 80-px thumbnail, straight from the photo host, not through the image optimiser.
- Data volume hardly changes the first load (empty and seeded within 0.2 s except search: 6.2 s empty, 7.1 s seeded), because pages draw first and fetch afterwards.

### B3. Real conditions (Playwright, Chromium, median of 3; "usable" = the main control is on screen and React has attached to it)

| Profile | Home | Search | Listing | Checkout |
|---|---|---|---|---|
| desktop, no throttling | 0.2 s | 0.3 s | 0.2 s | 0.2 s |
| slow 4G | 3.8 s | 3.5 s | 4.5 s | 4.0 s |
| 3G | 5.3 s | 4.7 s | 5.7 s | 5.2 s |
| latency 300-600 ms per request | 1.2 s | 1.4 s | 2.0 s | 2.0 s |
| stalls (5%) and connection resets (2%) | **never** | **never** | **never** | **never** |
| CPU 4x slower | 0.5 s | 1.0 s | 0.6 s | 0.5 s |
| iPhone size, slow 4G, CPU 4x | 3.8 s | 3.6 s | 4.5 s | 4.1 s |
| low-end Android size, 3G, CPU 6x | 5.3 s | 4.8 s | 5.9 s | 5.3 s |

First paint is 1.5-1.7 s on slow 4G and 3G; the page is usable 2-4 s later. Nothing shifts (CLS 0 to 0.04).

**"Never" is a finding (G6), not a slow page:** with one reset among the page's requests, every page stayed on its loading state for the whole 60 s. Probes, one failure at a time: a reset JavaScript chunk leaves checkout on "Loading booking details…" for good, with no retry and no error; a reset booking request shows "Booking unavailable… Go back and pick new dates" (the booking is fine); a reset session check sends the guest to log-in (G1).

Money under bad conditions:

| Check | Result |
|---|---|
| Pay pressed three times on slow 4G | 1 request sent, 1 payment row: protected |
| Offline when Pay is pressed | the guest is told ("Network error…"); nothing recorded; online again, one press, paid once |
| The answer to Pay lost on the way back | the payment had been started; pressing Pay again hands back the same one: 1 row, paid once |
| The answer to Book lost on the way back | the booking **was** made; the guest is told nothing, and pressing Book again says "Those dates just became unavailable" (G7) |

### B4. Page to page (Chromium, 5 runs, cold and warm)

| Pair | Click to visible (cold / warm) | Layout shift | Blank or flash |
|---|---|---|---|
| home → search | 166 / 164 ms | 0 | a spinner for 2 frames |
| search → listing (card) | 141 / 148 ms | 0 | 1 blank frame |
| home → how it works | 72 / 69 ms | 0 | none |
| how it works → FAQ | 119 / 108 ms | 0 | none |
| host dashboard → host bookings | 102 / 112 ms | 0 | a spinner for 2 frames |

No full page reloads; every link stayed a client-side navigation. Header links are all prefetched; on the search grid only the cards in view are (12 of 56, Next's normal rule). Back from a listing to search takes 159 ms but **the place in the results is lost** (the list scrolls inside its own panel and comes back at the top, G8). Gallery: first photo eager, the rest lazy, all through the optimiser; search grid: all optimised, but the first five, above the fold, are lazy (G9).

Not measured, and why: home → listing (the cached home page links to a listing that no longer exists, G10) and guest dashboard → booking (a short stay has no link to its booking page anywhere in the app, G11).

### B5. Server timings (seeded database, one request at a time, 50 per route after 3 warm-ups)

No route answered 5xx. Everything a guest touches is under 45 ms at p95. The slow ones:

| Route | p50 | p95 | p99 |
|---|---|---|---|
| `GET /api/admin?type=stats` (admin overview) | 690 ms | 706 ms | 712 ms |
| `GET /api/admin/verifications` | 642 ms | 684 ms | 687 ms |
| `process-payouts` (dry run) | 302 ms | 308 ms | 308 ms |
| `POST /api/auth/signin` (bcryptjs, cost 12) | 222 ms | 237 ms | 240 ms |
| `POST /api/auth/signup` (bcryptjs) | 222 ms | 224 ms | 228 ms |
| `GET /api/admin/listings` | 104 ms | 111 ms | 112 ms |
| `GET /api/admin/users` | 95 ms | 99 ms | 122 ms |
| `GET /api/admin/listing-checks` | 82 ms | 84 ms | 109 ms |
| `GET /api/listings` with dates | 41 ms | 43 ms | 48 ms |

Full list: `server-timing-seeded.json`. The 15 slowest statements with their plans (EXPLAIN ANALYZE, BUFFERS via auto_explain): `explain-top15.json`. The two slowest by far (174 ms and 134 ms) are the "payouts due" queries, run by the payout job, the admin overview and the Verifications tab: each walks every paid booking in history (42,039 and 28,635 rows) and checks Payout for each (G12). Search with dates reads every booking for the overlap test (53 ms).

Sequential scans during one pass: Booking 35.6 M rows read (711 scans), Payment 19.1 M (342, never by index), Message 15.9 M (159), Payout 10.8 M, Review 5.4 M (318, never by index). Unused indexes: only unique keys that guard against duplicates (kept on purpose).

**Proposed indexes** (`e2e/load/proposed-indexes.sql`, shown, not run on any live database; applied to the test database only to measure, then removed): 17 indexes on foreign keys and the date search. Measured, 30 requests a route: p95 falls 40-70% on the routes people use most (a guest's bookings 11.2 → 4.7 ms, payments 10.5 → 3.1, messages 10.5 → 4.3, a host's bookings 12.6 → 6.9, booking a home 15.5 → 6.0, a listing 11.0 → 3.0); date search 43 → 39 ms; the slow admin routes and payout job unchanged. One candidate, `Payout(instalmentId)`, made the payout job and both slow admin routes 10-20% slower, and is left out.

Invariants after Stage B: all hold (`e2e/.reports/invariants/end-of-B.json`).

---

## Second go, Stage C: load, concurrency, stress, soak (2026-10-15/16, branch `e2e-performance`)

**The load generator (k6 2.3.0) ran on the same MacBook Air as the four app servers, Postgres and the fakes.** Every number below includes that competition for the same 10 cores. k6 2.3.0 is the official macOS arm64 release archive; its SHA-256 matches the checksum file published with the release (both from the same GitHub release; the binary has no Apple signature). Machine at the start: 35 GB free, on mains power, no thermal or performance warning; none was recorded during any run.

### The set-up, and what it cannot reproduce

| Production | Here |
|---|---|
| `DATABASE_URL`: Supavisor transaction pooler (`*.pooler.supabase.com:6543`, `?pgbouncer=true`), **no `connection_limit`, no `pool_timeout`** in the URL, so Prisma uses its defaults: `physical CPUs × 2 + 1` connections per server instance and a 10 s wait for one | `connection_limit=5` per app process, set by `run.mjs up --pool=5` (Prisma's default on a 2-vCPU function; left unset here it would be 21 per process on this 10-core Mac). Prisma's 10 s wait, unchanged |
| Supabase Postgres, its own connection limit | Postgres 17 (native arm64), `max_connections=60` |
| Many Vercel function instances | **4** `next start` processes sharing the database (`--apps=4`), each request sent to one of them by the visitor's number |
| The network between Vercel and Supabase | a TCP proxy adding 30-80 ms to every round trip to Postgres (`--db-latency=30-80`, `e2e/fakes/db-latency.mjs`) |

Cannot reproduce: Supavisor itself (its pool size, queueing and transaction-mode behaviour), the real network and TLS to the database, Vercel's serverless model (instances started and stopped on demand, one-at-a-time vs Fluid concurrency, the function time limit), cold starts, CDN caching of pages, a load generator on separate hardware, real Paystack and real phones.

Traffic: each virtual user (VU) is one visitor with its own address in `x-vercel-forwarded-for`, so the rate limits stayed **on**. Mix per round: 60% browse and search, 25% listing views, 8% sign-in and dashboards, 5% bookings (instant book, far-future dates on load listings), 2% payments (book, start, pay at the fake Paystack, come back through verify). Think time 1-5 s between pages. Seeded database throughout. Order run: smoke, average, ramp-up, spike, breakpoint, soak; each resumable (`e2e/load/stage-c.sh`).

### Results per scenario (browse and write: p50 / p95 / p99 in ms; app CPU is the four processes added together, 100% = one core)

| Scenario | Requests | Req/s | Browse | Write | Failed | 5xx / no answer / 429 | Bookings / payments | App CPU max | App memory max | DB connections max |
|---|---|---|---|---|---|---|---|---|---|---|
| smoke (2 VUs, 1 min) | 89 | 1.2 | 329 / 932 / 1,449 | 2,052 / 2,055 / 2,055 | 0.00% | 0 / 0 / 0 | 1 / 0 | 6% | 781 MB | 9 |
| average (50 VUs, 10 min) | 16,987 | 25.2 | 378 / 1,067 / 1,599 | 2,329 / 3,732 / 5,029 | 0.00% | 0 / 0 / 0 | 197 / 65 | 110% | 1,085 MB | 21 |
| ramp-up (to 200 VUs, 16 min) | 30,721 | 31.7 | 1,284 / 4,596 / 8,111 | 8,025 / 24,328 / 25,225 | 0.59% | 182 / 0 / 0 | 196 / 59 | 133% | 996 MB | 21 |
| spike (50 → 500 VUs in 10 s) | 19,789 | 36.6 | 839 / 10,430 / 10,700 | 5,093 / 30,002 / 30,002 | 10.25% | 1,820 / 208 / 0 | 81 / 23 | 160% | 1,053 MB | 33 |
| breakpoint, stops on latency | 1,807 | 29.3 | 570 / 2,304 / 2,848 | 2,580 / 6,955 / 8,756 | 0.06% | 1 / 0 / 0 | 14 / 2 | 93% | 979 MB | 33 |
| breakpoint, stops on errors (declared rerun) | 4,869 | 38.1 | 1,336 / 10,007 / 10,702 | 18,038 / 30,002 / 30,002 | 2.03% | 57 / 42 / 0 | 12 / 2 | 141% | 1,024 MB | 33 |
| soak (50 VUs, 60 min) | 104,775 | 29.0 | 404 / 1,120 / 1,675 | 2,374 / 3,752 / 5,613 | 0.00% | 1 / 0 / 3 | 1,219 / 327 | 81% | 1,019 MB | 33 |
| no DB latency: breakpoint, stops on errors (declared) | 124,435 | 267.1 | 249 / 6,422 / 10,808 | 1,231 / 29,791 / 30,001 | 2.19% | 385 / 2,338 / 9 | 887 / 209 | 495% | 1,316 MB | 21 |
| no DB latency: sign-in only (declared) | 877 | 10.0 | 230 / 2,169 / 2,749 | – | 0.11% | 0 / 0 / 0 | – | 405% | 876 MB | 21 |

**The money and date rules held before and after every scenario: 17 checks in this stage (19 with Stage B's two), none broken** (`e2e/.reports/invariants/`).

- **Average and soak** (50 visitors): no failures; browse p95 about 1.1 s, writes p95 about 3.7 s. The time is spent waiting on database round trips (each route makes several, one after another; one listing search is 557 ms through 30-80 ms against 15 ms without), not on CPU: the four processes used a quarter of one core between them.
- **Soak drift: none.** Requests per second, p50 and p95 were the same in every 10-minute slice (p95 1.63-1.82 s); memory per process settled at 240-251 MB by minute 10 and ended at 250-254 MB; connections steady at 33; no lock waits; 1 error in 104,775 requests.
- **Ramp-up:** from about 100 visitors every connection is held "idle in transaction" (a transaction waiting on its next round trip), throughput stops rising at about 60 transactions a second, and requests queue for a connection. 180 of 376 bookings (48%) failed with 500 (Prisma P2028: no connection to start the transaction in time); sign-in p50 13 s, p95 25 s; even the one-row exchange-rate read waited 2.2 s.
- **Spike:** throughput capped at about 56 requests a second; 10% of requests failed during the spike (Prisma P2024, "timed out fetching a new connection", 1,806 times; 208 sign-ins got no answer in 30 s). **It recovered by itself within 30 s** of the spike ending. HTML pages stayed under 10 ms throughout (they are static).
- **Breakpoint:** latency breaks first, at **about 43 requests a second** (browse p95 over 2 s; writes 7 s), with errors still 0.06%. Rerun once, declared, stopping on errors instead: errors pass 2% at **about 45 requests a second**, sign-in and booking first.
- **First bottleneck: the database connection pool**, not CPU. Transactions hold a connection for several round trips each, so 20 connections at 30-80 ms run out at about 45 requests a second.
- **Your prediction (sign-in CPU because of bcrypt):** refuted with database latency, where CPU stayed low while the pool ran out. **Confirmed where the database is fast:** run without the latency proxy (declared), sign-in alone saturates every process at about **15 sign-ins a second across 4 processes, about 4 a second per process** (each takes about 220 ms of single-threaded CPU in bcryptjs); and the full mix scales to about **300 requests a second clean and 370 at most**, when all four processes reach 100% CPU, booking failing first (serializable retries exhausted, then pool timeouts).

### Capacity, in plain words

On the production-like set-up (4 server processes, 5 connections each, 30-80 ms to the database):

- **Browsing:** about **50-70 people browsing at once** with normal pauses (about 30-40 requests a second) stay comfortable: no errors, pages' data in about 0.4 s typical, 1.1 s at worst for 1 in 20. Beyond about 100 at once it slows sharply; at 500 at once 1 request in 10 fails.
- **Bookings:** about **20 a minute** with 0 errors during the soak (1,219 in an hour) alongside that browsing; at 100-200 visitors half the booking attempts failed.
- **Payments:** about **5 a minute** with 0 errors during the soak (327 in an hour); payment starts failed rarely (2 of 68) in ramp-up.
- **What breaks first:** the database connections (the pool), from the number of round trips each request makes while holding one. Then sign-in and booking, which hold transactions longest.

What it implies for Vercel + Supabase (an inference from these runs, not a measurement of them):

- Response time will be set mostly by **the round-trip time between the Vercel function region and the Supabase region**, multiplied by the number of queries each route makes in turn (about 10 for a listing search). At 30-80 ms that is 0.4-0.6 s per API call; if the two regions are on different continents (100-200 ms), expect 1-2 s per call before any load.
- Capacity will be set by **Supavisor's pool size for the plan** (how many transactions can run at once), not by how many function instances Vercel starts. More instances only queue more work at the pooler. The ceiling seen here (about 20 transactions at once, about 45 requests a second) is of the same order as Supabase's smaller computes.
- Each function instance's Prisma pool is unset in production. Under transaction pooling each instance can open `CPUs × 2 + 1` client connections; many instances can exhaust Supavisor's client limit before its pool.
- Sign-in costs about 220 ms of CPU per request; on a function that serves several requests at once (Fluid compute) it holds up every request on that instance meanwhile.

### What to change or buy before launch, ranked

1. **Put Vercel's function region next to Supabase's region** (same cloud region), and choose that region for Ghana (for example Supabase `eu-west-2` London with Vercel `lhr1`, or the nearest pair available). Free; the largest single effect on every response.
2. **Fix G6 and G1** (pages that stay stuck after one failed request; one failed session check signs a guest out). They are what people on mobile data will meet first, at any load.
3. **Fix G15** (a second payment opened for a booking just paid) before taking real money.
4. **Cut database round trips on the busy paths and shorten interactive transactions**: run independent queries together, read the exchange rate, region counts and featured listings from a short cache (every page asks for them), and keep work that does not need the transaction outside it. This raises what the same pool can carry.
5. **Apply the proposed indexes** (`e2e/load/proposed-indexes.sql`, G13), through a reviewed migration.
6. **Set the pool explicitly**: add `connection_limit` (for example 3-5) and `pool_timeout` to `DATABASE_URL` on Vercel, and **size the Supabase compute for its pooler limits** (a larger compute has a larger pool). Watch connection counts in the Supabase dashboard during the first weeks (G16).
7. **Make sign-in cheaper**: native `bcrypt` instead of `bcryptjs`, or cost 11 (about half the CPU of 12) after a security review; existing hashes still verify.
8. **Change the payouts-due queries** (G12) before booking history grows: they read every paid booking on every run.
9. **Rate limits:** they held throughout (3 refusals in the soak, all intended). Not tested here: many people in Ghana reach the internet through mobile carriers' shared addresses (carrier-grade NAT), so per-address limits (20 sign-in failures and 5 sign-ups an hour) may refuse real people who share one address. Worth a decision.
10. **Vercel Pro** is already planned; its function limits were not tested here.

---

## After the fixes (2026-10-13, branch `e2e-fixes`)

Run against a production build of the branch, on this machine, with the local
test stack. All 17 findings of the first go are fixed except the text
contrast part of F12, which is a proposal (`CONTRAST-PROPOSAL.md`). No test is
marked as known-failing any more. `FINDINGS.md` has what was done for each.

| Run | Result |
|---|---|
| Everything in Chromium | 147 passed, none on a retry (4 skipped: the opt-in contrast measurement) |
| Crashes and the database, run alone | 10 passed |
| Every race at 50 rounds, first time | 30 passed |
| Every race at 50 rounds, second time | 30 passed |
| Core set in Firefox, WebKit, tablet, iPhone and Android sizes | 75 passed, 19 skipped as before, 1 failed (see below) |
| Fuzz: 1,360 hostile bodies to 34 routes, 240 hostile query strings | none answered wrongly, with nothing set aside |
| Accessibility scan | passes against a baseline with no unnamed button, field or select box |
| Unit tests in six time zones | 1,355 passed in each |
| Removal proofs | 185 of 185 hold |

The one failure in the other browsers was the test "signing out from the menu"
on the tablet set-up: the test asked for the dashboard while the app was still
doing its own redirect after signing out. The sign-out code is unchanged on
this branch. The test was corrected and then passed 36 times out of 36 across
the six browser set-ups. The whole other-browser run was not repeated after
that.

Two things went wrong during the work and were put right:

- The F14 commit wrote its new tests over an existing file of 15 tests
  (`src/lib/security/input.test.ts`). The removal proofs caught it. The file
  is restored exactly as it was and the new tests are in
  `unreadable.test.ts`. The six time-zone runs were repeated afterwards with
  all 1,355 tests.
- One slow unit test (23 real password checks, about 4.5 seconds against a
  5 second limit) failed twice in the time-zone runs and passed alone. It was
  already that slow before this branch. It now has a 20 second limit.

The first go's report follows as it was written.

---

# First go (stages 0 to 3)

Run on 2026-10-12 against a production build of `main` + Next 16.3.8, on this
machine, with the local test stack described in `README.md`. Nothing under
`src/` was changed. Performance, throttling, Lighthouse, load, stress and soak
work is the second go and has not been run.

## Results

| Area | Tests | Result |
|---|---|---|
| Harness and guards (smoke) | 5 | pass |
| Main journeys in the browser (smoke) | 2 | pass |
| Journeys: accounts, search, booking, paying | 17 | 16 pass, 1 known failing (F13) |
| Journeys: cancellation, payouts, disputes | 26 | pass |
| Journeys: host ID, listing checks, calendar, reviews, messages | 7 | pass |
| Journeys: rent by the month | 5 | pass |
| Site crawl, 36 pages as 4 kinds of visitor | 4 | pass: no broken link, console error or failed request |
| Navigation: deep links, back/forward, refresh, double clicks, two tabs, keyboard | 16 | 12 pass, 4 known failing (F1 ×3, F2) |
| Accessibility scan (axe) | 4 | pass against the baseline; the baseline itself is finding F12 |
| Races: dates, paying, jobs, admins, rent, accounts, limits | 30 | 23 pass, 7 known failing (F2, F3, F4, F6, F7, F8, F11) |
| Failures: Paystack, email, storage, exchange rate | 24 | 23 pass, 1 known failing (F9) |
| Fuzz: bodies, raw bodies, query strings, uploads | 7 | 3 pass, 4 known failing (F14 ×2, F15, F16) |
| Crashes and the database (run alone) | 8 | 7 pass, 1 known failing (F17) |
| Core set in Firefox, WebKit, tablet, iPhone, Android sizes | 95 | 76 pass, 19 skipped (see "Not tested") |

Chromium: 155 tests, of which 18 are known-failing tests for 14 of the 17
findings (the other three are measured or held by a baseline); the other 137
pass. Two full runs in a row were clean, with no test passing only
on a retry. Every race was also run 50 rounds. The money and date rules
(`lib/invariants.ts`) held after every test, and no rule was seen broken even
for a moment by a test running beside another.

Run time: smoke 5 s; everything in Chromium 4 min; the crash set 25 s; the
other browsers 2.6 min.

## What held

- No double charge counted as paid, no double payout, no double refund, no
  oversold dates, in any race or crash: two servers running the payout,
  refund, send and expiry jobs at once; the webhook 20 times before, during
  and after the browser's return; a forged webhook; the server killed before
  and after Paystack accepted a transfer; a retry meeting the normal run.
- A host is paid 90% of the rent, once, only after 48 hours, an approved ID,
  a payout method a day old, and not while suspended or disputed.
- Refunds match the policy table at every tier boundary, to the pesewa.
- With the database down the site answers plain errors, leaks nothing, makes
  no booking, and recovers by itself.
- Hostile uploads are all refused; nothing was stored outside its folder.
- Nothing tried to reach outside this machine, from the server or the browser.

## Findings

See `FINDINGS.md` for each one with how to reproduce it. In order:

- **Critical:** F11 (cancel at the moment of payment: paid, cancelled, no refund on record).
- **High:** F2 (Pay pressed twice charges twice), F4 (sign-in limit beaten by parallel guesses), F9 (no time limit on calls to Paystack), F17 (payout converted at the day's rate: decision needed).
- **Medium:** F1 (redirect after log-in lost), F3 (unrelated bookings abort each other), F7 (sign-up limit beaten by parallel requests), F12 (accessibility).
- **Low:** F5, F6, F8, F10, F13, F14, F15, F16.

## Not tested

- Everything in the second go: Lighthouse and Web Vitals, throttled networks, page-to-page timings, server timings on a large database, load, spike, stress, soak, capacity.
- Logging in through the form in WebKit (18 tests skipped in the WebKit, tablet and iPhone projects): WebKit drops the `Secure` session cookie on `http://localhost`. Those projects sign in by setting the cookie instead. Needs an https front on the test stack.
- The map in Firefox (1 test skipped): headless Firefox has no WebGL here.
- Real Paystack, Resend, Supabase Storage, MapTiler and Sentry. The fakes follow their documented behaviour as the app uses it; where the fake had to guess (a duplicate transfer reference is refused with HTTP 400) it follows the app's own comments.
- The Supavisor pooler, TLS to the database, Vercel's many instances and its limits. Two server processes stand in for instances.
- Creating a listing through the multi-step form, sending an ID through the upload page, and the admin tabs' buttons: these were done through the same API the pages call, not by clicking.
- SMS (no adapter exists), the 14-day stop of rent reminders, the deposit kept or returned in a host's dispute, the review auto-publish after 14 days.
- Clock edges (Ghana midnight, month ends, leap day) at the level of the running server. They are covered by the unit tests in six time zones; no new property tests were added.
- Screen readers. axe finds a part of what a person would.
