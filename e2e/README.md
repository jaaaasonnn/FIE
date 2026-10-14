# End-to-end tests

Real browsers against a production build (`next build` + `next start`), with
a local Postgres and local stand-ins for every outside service. Nothing here
can reach the live database, Paystack, Resend, Arkesel, Sentry, Supabase or MapTiler.

## Commands

```bash
npm run e2e:up        # terminal 1: Postgres, fakes, build if needed, two app servers. Stays running.
npm run e2e:smoke     # terminal 2: the fast set, a few minutes
npm run e2e           # everything in Chromium, then the tests that break things on purpose
npm run e2e:all       # the above plus the core journeys in Firefox, WebKit, tablet and two phones
npm run e2e:down      # stop everything
```

- `node e2e/run.mjs up --build` rebuilds the app first. Do this after changing anything under `src/`.
- `node e2e/run.mjs up --fresh-db` drops and re-creates the test database. The tables are made once, so do this after any change to `prisma/schema.prisma`.
- `node e2e/run.mjs test <playwright args>` passes arguments through, for example `tests/races -g "same dates" --repeat-each=20`.
- `node e2e/run.mjs exec <command>` runs any command with the test environment.
- Reports: `e2e/.reports/html` (open `index.html`), traces for failed tests in `e2e/.reports/artifacts`. Logs: `e2e/.state/*.log`.
- Stop `next dev` first: the tests build into the same `.next` folder.

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
| Supabase Postgres 17.6 behind the Supavisor pooler | Postgres 17.10 from `embedded-postgres`, `max_connections=60`, tables from `prisma db push`, then `prisma/enable_rls.sql` and `prisma/constraints.sql` unchanged, with the roles `anon`, `authenticated` and `service_role` created first. **No pooler.** |
| Vercel (many instances) | Two `next start` processes on ports 3200 and 3201 sharing the database. Race tests send their two requests to different processes. |
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
