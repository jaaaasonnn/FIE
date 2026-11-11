# End-to-end tests

Real browsers against a production build (`next build` + `next start`), with
a local Postgres and local stand-ins for every outside service. Nothing here
can reach the live database, Paystack, Resend, Arkesel, Sentry, Supabase or MapTiler.

## Commands

```bash
npm run e2e:up        # terminal 1: Postgres, fakes, build if needed, two app servers. Stays running.
npm run e2e:smoke     # terminal 2: the fast set, a few minutes
npm run e2e           # everything in Chromium, then the bursts of bookings (AS3) alone, then the tests that break things on purpose
npm run e2e:all       # the above plus the core journeys in Firefox, WebKit, tablet and two phones
npm run e2e:down      # stop everything
```

- `node e2e/run.mjs up --build` rebuilds the app first. Do this after changing anything under `src/`.
- `node e2e/run.mjs up --fresh-db` drops and re-creates the test database. The tables are made once, so do this after any change to `prisma/schema.prisma`.
- `node e2e/run.mjs test <playwright args>` passes arguments through, for example `tests/races -g "same dates" --repeat-each=20`.
- `races/contention.spec.ts` is its own project, `contention` (one worker, nothing beside it): `node e2e/run.mjs test --project=contention`. The `chromium` project leaves it out. Its bursts of bookings load the one Postgres for about 12 minutes, and in the first AS3 full set a timing-bound race beside them ran past its limit.
- `node e2e/run.mjs exec <command>` runs any command with the test environment.
- Reports: `e2e/.reports/html` (open `index.html`), traces for failed tests in `e2e/.reports/artifacts`, every test's result in `e2e/.reports/results.json`. Two test processes can share the stack: each tags its people with its own id and cleans up only those (SU10). `E2E_REPORT_DIR=<folder>` puts all three in a folder of the run's own, so one suite's results are never overwritten by the next. Logs: `e2e/.state/*.log`.
- Stop `next dev` first: the tests build into the same `.next` folder.

## Page speed (G5)

```bash
zsh e2e/load/measure-g5.sh <label>              # rebuild, bundle guard, Lighthouse on the empty and seeded databases (resumable)
node e2e/load/compare-g5.mjs <before> <after>   # the table against the budgets, written to e2e/load/results/g5-<after>.md
E2E_LH_THROTTLING=devtools node e2e/run.mjs exec node e2e/load/lighthouse.mjs <label> 3   # the browser really slowed, not simulated
```

- `tests/perf/bundle.spec.ts`: the script budget (350 KB on first load, the router's prefetches left out; desktop
  search with its map 650 KB), and the map and date picker only when asked for. Each page's files: `.reports/bundle/`.
  The map's worker file (maplibre 6) is fetched by the worker, so the page sees the request but not its bytes: the
  guard counts it from the file as the server sends it (gzip). Desktop search with the map is at 649.8 of 650 KB (app shell stage 2): the first job of stage 3 is to keep the phone-only search code off desktop (`FINDINGS.md`, AS8).
- `tests/perf/tab-timing.spec.ts` (only with `E2E_TAB_TIMING=<label>`, stack started with `up --perf`): how long each
  bottom-bar tab takes on the contention lane at 0 and 5-15 ms from the database, a tap in the browser and a full
  load, the API routes behind them, and each tap's queries (pg_stat_statements in a schema of its own, dropped after).
  Written to `load/results/tab-timing-<label>.md`. `tests/journeys/tab-tap.spec.ts` is the guard (AS25).
- `tests/journeys/map.spec.ts`: pins, the popup and its link, clusters that zoom apart or list homes that share a
  spot, Enter and Escape, the map's credits, and no map or worker error. `E2E_MAP_SHOTS=<label>` saves screenshots
  to `.reports/map-shots/`. The harness's map style is a plain background: no streets, real pins and popups.
- `tests/perf/server-first.spec.ts`: the server-first pages' data is in their HTML, shows with the browser's own
  request blocked, and React keeps the copy the server sent. Their fallbacks when the server cannot read in time
  are in `tests/chaos/server-first.spec.ts`, which locks a table for longer than the server waits.
- Simulated LCP (Lighthouse's default) for pages whose data comes with the HTML lands at about 2.4 or 3.1 s from
  run to run; the devtools runs are the check. Do nothing heavy on the machine while measuring.
- `page.goto` in the test fixture returns once a streamed page has settled and React has taken it over: a hidden
  copy of the page can sit in the document for up to about 300 ms, and a click before React attaches is lost.
- A removal proof marked `"e2e": true` names an end-to-end test: the runner rebuilds the app from the changed
  source (`scripts/e2e-proof.mjs`) and rebuilds it from the committed source at the end. It needs the stack up.

## The installed app (stage 4)

```bash
node e2e/run.mjs test --project=chromium tests/journeys/installed-app.spec.ts      # manifest, icons, worker, offline, top of the screen, hint
node scripts/app-icons.mjs --preview                                              # redraw the icons; preview sheet in .reports/stage4-icons/
E2E_STAGE4_SHOTS=<label> [E2E_STAGE4_BASE=<label>] node e2e/run.mjs test --project=chromium --project=iphone --project=android tests/layout/stage4-shots.spec.ts --workers=1
```

- The installed app is a real app window: full Chromium (Playwright's `chromium` channel, not the headless shell) opened
  with `--app=<address>` (`lib/installedApp.ts`). There `display-mode` is really `standalone`, on every page it goes to.
  Nothing is installed: installing through the browser (CDP `PWA.install`) writes an app to `~/Applications` on the Mac.
  Phone emulation (`isMobile`) is not used there: with it the app window opens blank.
- The app window is its own browser, outside the test's context: Playwright's trace does not record it. To see
  where such a test stalls, log each step with its time. About one window in 300 stops answering Playwright as it
  starts (AS23, proven): `installedApp()` gives the start-up 20 s, then ends that Chromium and starts the window again
  once, logged `[e2e] AS23`. `E2E_AS23_DRILL=1` makes every first start give up at 200 ms, to try the second start. Measure anything that slides in (the map, the sheet) only
  once its animation has finished (`el.getAnimations()`): mid-slide it is far down the screen (proof 341).
- An iPhone's safe areas: CDP `Emulation.setSafeAreaInsetsOverride` (top 59, bottom 34, `ISLAND`). In a normal tab
  the same insets must change nothing (the rules are under `display-mode: standalone`).
- Chromium's install check (`Page.getInstallabilityErrors`) needs full Chromium in a profile of its own: in an
  incognito context it always reports `in-incognito`, and the headless shell reports nothing even with an icon missing.
- Service workers are blocked in every test (`serviceWorkers: 'block'` in the config); a test that needs one allows it
  (`test.use({ serviceWorkers: 'allow' })`, or its own context). A worker answers requests before `page.route` sees them.
- The pixel comparison: run it on a build of `main` (copy the spec and `lib/png.ts` in, untracked) with one label, then
  on the branch with `E2E_STAGE4_BASE` set to it. Check first that the two builds have the same font files
  (`md5 .next/static/media/*.woff2`): each build downloads Manrope from Google, and the files differ between builds
  (FINDINGS AS20), which changes every letter's pixels. Two shots of one build can differ by one colour level at a few
  edges in Chromium, and at the logo's mark and listing photos in WebKit: one level is allowed and counted, the logo
  marks are covered in the iPhone set-up.
- What emulation cannot show is in `REAL-PHONE-CHECKLIST.md`, for the owner's phones.

## Guards

Every process is started by `run.mjs` with the environment from `env.e2e`. It never reads `.env`.

1. **No real value is ever read.** `lib/env.mjs` gives every key that `.env` has a fake value or a placeholder. Next and Prisma only read a key from `.env` when the process has none.
2. **It refuses to start** unless the database is `127.0.0.1:54329/fiegh_e2e`, the Paystack, Resend and Arkesel keys are the fake ones, the Sentry address is local and there is no Sentry upload token.
3. **The marker row.** The test database has a table `e2e_marker`. `lib/db.ts` will not delete or shift anything without it.
4. **Nothing leaves the machine.** `preload/egress.cjs` is loaded into the app's server process by the launcher only. It refuses every connection that is not loopback and sends the hosts the app has written into its code (Paystack, Resend, Arkesel, the exchange-rate API, Unsplash, storage) to `fakes/server.mjs`. Refusals are logged, and a run fails if the log is not empty. The preload is not referenced by anything under `src/`, and it throws if loaded outside the launcher; `tests/smoke/stack.spec.ts` proves both.
5. **The browser too.** `lib/test.ts` answers map tiles and photos locally and refuses, records and fails on any other request that is not to this machine.
6. **Switches are on here only**, in `env.e2e`, against the fakes. Nothing in this folder writes to `.env` or to Vercel.

Two things do use the network, as they always have: `npm install`, and `next build` fetching the Manrope font files from Google.

## What stands in for what

| Real thing | Here |
|---|---|
| Supabase Postgres 17.6 behind the Supavisor pooler | Postgres 17.10 from `embedded-postgres`, `max_connections=60` (each app server's Prisma pool is 10: `run.mjs`, `--pool=N` or `E2E_APP_POOL`), tables from `prisma db push`, then `prisma/enable_rls.sql` and `prisma/constraints.sql` unchanged, with the roles `anon`, `authenticated` and `service_role` created first. **No pooler.** |
| Vercel (many instances) | Two `next start` processes on ports 3200 and 3201 sharing the database. Race tests send their two requests to different processes. |
| Vercel `dub1` a few ms from Supabase `eu-west-1` | A third `next start` on 3204 (the contention lane, pool 20) whose database goes through `fakes/db-latency.mjs` on 54330. A test sets its delay with `setLaneLatency` (`lib/lane.ts`, control port 54334): `REALISTIC` 5-15 ms, `STRESS` 30-80 ms (AS3). |
| Paystack | `fakes/server.mjs`: initialize, a checkout page with Pay / Declined / Close, verify, refund, transfer, bank list, account resolve, signed webhooks. A duplicate transfer reference is refused with HTTP 400, as the app's own comments say Paystack does. |
| Resend | An inbox the tests read. Honours `Idempotency-Key`. |
| Arkesel (SMS) | Send and balance, answered as Arkesel's published spec shows them; every SMS it took, for the tests to read; a balance that runs down and can be set; and, when a test asks, a delivery report sent to the link the SMS carried. People have no phone number unless a test gives them one. |
| Supabase Storage, Unsplash | In-memory files and generated photos, over a local TLS port so Next's image optimiser works unchanged. |
| Sentry | Collects what would have been sent, so alerts can be asserted. |
| MapTiler | A blank map style answered in the browser. |
| Time passing | `ageBooking()` moves a booking's stored dates back. The server's clock is never changed. |
| A visitor's IP address | The `x-vercel-forwarded-for` header, the first one `ipHashOf` reads. Each test and each person gets its own, so rate limits stay on and never collide. |

## Layout

- `run.mjs`, `env.e2e`, `lib/env.mjs`: the launcher and its guards
- `preload/`, `fakes/`: the outbound guard and the stand-ins
- `lib/`: `test.ts` (fixtures), `world.ts` (people, homes, bookings, payments), `db.ts`, `fakes.ts`, `invariants.ts`
- `pages/`: page objects
- `tests/`: `smoke`, `journeys`, `navigation`, `a11y`, `races`, `chaos`, `fuzz`
- `tools/`: helpers for writing tests (not tests)
- `ci/e2e.yml`: a proposed GitHub Actions workflow (manual trigger, smoke set). Not active: copy it to `.github/workflows/` to turn it on
- `REPORT.md`: the results of the last full run
- `FINDINGS.md`: every bug and weakness found, ranked, with how to reproduce

## Rules for tests

- Each test makes its own people and homes through `world` and they are deleted by id afterwards. Tests never share data.
- No fixed waits. Use web-first assertions, `expect.poll`, or `until()` from `lib/fakes.ts`.
- One retry, and the trace of a failed attempt is kept. A test that passes only on retry is a bug to fix, not to accept.
- A test for a known bug expects the right behaviour and is marked `test.fail()` with the finding's number.
- Tests that fire a cron job assert on their own rows, never on the job's whole answer: other tests run beside them.
- After anything that touches money, call `expectInvariants()`.
