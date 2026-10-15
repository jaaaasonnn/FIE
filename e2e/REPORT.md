# End-to-end test report

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
