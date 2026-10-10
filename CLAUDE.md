# FieGH — Project Context for Claude Code

## What This Is
FieGH is a Ghana-focused property rental marketplace web app — a culturally grounded alternative to Airbnb and informal booking channels like WhatsApp and Facebook Marketplace. It targets both short and long-term rentals. Distinct Ghanaian identity expressed through design, currency (GH₵), and mobile money payment support.

Built solo by the project owner, working in Cursor on a Mac. Claude Code is used selectively (terminal), alongside Claude.ai chat for planning/strategy — both share one Pro subscription token pool, so use Claude Code deliberately for tasks needing real file/network access.

## Brand & Design System
- Color palette: gold `#C9932E`, warm off-white `#FAF7F2`
- Typography: Manrope (free alternative to Airbnb's Cereal typeface)
- Tone: culturally warm, Ghanaian identity preserved — but copy/meta not exclusively Ghana-framed
- Design principle: airy, Airbnb-inspired feel while preserving FieGH's distinct Ghanaian identity — warmth in the experience, not just surface-level copy

## Current State (Built & Wired to Real Data)
- MapLibre GL JS + MapTiler interactive map with price-pin markers and clustering
- Booking system with availability/calendar logic and double-booking prevention
- Real user authentication (email + Ghana phone numbers), guest/host/admin role separation, protected routes
- Guest flows: payments, wishlist (heart button functional), messages
- Host dashboard: messages, payouts (UI only — blocked on Paystack, see below)
- Public profiles, admin panel, listing creation (previously silently failing — now fixed)
- Full guest-host messaging: conversation threads, send functionality, polling
- UI refinement pass done: header scroll behavior, Airbnb-style card/spacing warmth, Manrope font swap

## Parked / Unresolved Issues

_(none currently — Paystack and Supabase migration below are resolved)_

## Roadmap

**Phase 1 — Core features (DONE)**
1. ~~Resolve Paystack integration~~ — done: host payout transfer initiation + webhook handling (`7644c08`), SHORT_STAY payout cron (`022659b`)
2. ~~Profile editing flow~~ — done (`19f6ebb`)
3. ~~Host payout flow~~ — done: payout method schema/save (`9d3b1fc`), transfer initiation (`7644c08`)
4. ~~SQLite → Supabase migration~~ — done: `prisma/schema.prisma` datasource is `postgresql`, `.env` has `DATABASE_URL`/`DIRECT_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`

**Phase 2 — Deploy-readiness (current focus)**
5. Hosting setup and environment configuration — in progress:
   - Vercel confirmed as host (Pro plan required — Hobby's ToS bars commercial/payment use, and its once-daily cron cadence can't fit `update-exchange-rate`'s 6h cycle)
   - Cron auth fixed to Vercel's native `Authorization: Bearer <CRON_SECRET>` scheme, `vercel.json` crons wired for all 3 routes — hourly for `process-payouts`/`complete-bookings`, every 6h for `update-exchange-rate` (`31a5a2d`, `1609cca`, `767c6eb`)
   - Still open: connect GitHub repo to Vercel project, set the 17 env vars from `.env` in production, point `NEXTAUTH_URL` + Paystack dashboard webhook at the real domain, confirm Supabase plan (free tier pauses after 7 days idle — not viable for prod)
6. Security hardening
7. Error monitoring
8. End-to-end testing
9. Legal documentation

## Payout, completion and refund switches

The cron jobs do nothing risky until they are switched on in the environment. All of these variables are **off when unset**, and none is set in `.env` or on Vercel yet. Names and notes are in `.env.example`; the code is `src/lib/payoutSwitches.ts` and `src/lib/cronRuns.ts`.

- `PAYOUTS_ENABLED`: must be exactly `true` before any Paystack transfer is attempted. Otherwise `process-payouts` runs as a dry run: it reports what it would pay, writes nothing and calls nothing. The same check sits inside `initiateHostPayout`, so no other caller can start a transfer.
- `PAYOUTS_NOT_BEFORE`: a date (`YYYY-MM-DD`, UTC). Only bookings created on or after it can ever be paid out. Required: without a valid date, payouts stay in dry run even when enabled. Set it to the launch date so no test booking is ever paid.
- `COMPLETION_ENABLED`: must be exactly `true` before `complete-bookings` marks anything `COMPLETED`.
- `REFUNDS_ENABLED`: must be exactly `true` before any refund is sent to Paystack. While off, cancelling still works and the refund is recorded as owed (`Refund` row, status `PENDING`); nothing is sent. The hourly `process-refunds` job sends those once it is on. The check sits inside `sendRefund` (`src/lib/refunds.ts`), the only place a refund is started.
- `DISPUTE_DECISIONS_ENABLED`: must be exactly `true` before an admin's decision on a dispute takes effect. While off, deciding only reports what it would do and writes nothing. Reporting a problem and holding the payout are always on. A refund a decision creates is still behind `REFUNDS_ENABLED`, and a payout behind `PAYOUTS_ENABLED`.
- `PAYMENT_WEBHOOK_ENABLED`: must be exactly `true` before Paystack's `charge.success` webhook confirms a payment. While off, the event is signature-checked and logged as what it would do; nothing is written. The verify route confirms payments either way.
- `BOOKING_EXPIRY_ENABLED`: must be exactly `true` before `expire-bookings` ends anything. While off it is a dry run and never calls Paystack.
- `BOOKING_EXPIRY_NOT_BEFORE`: a date (`YYYY-MM-DD`, UTC). Only bookings created on or after it can ever be ended by the job. Required: without a valid date the job stays in dry run. Set it to the launch date.
- `RENT_REMINDERS_ENABLED`: must be exactly `true` before `rent-reminders` writes anything. While off it is a dry run and never calls Paystack.
- `RENT_DEPOSIT_COVER_ENABLED`: must be exactly `true` before an admin can cover a missed rent payment from the damage deposit. While off, the action only reports what it would do and writes nothing.
- `PAYOUT_LIMIT_GHS`: not a switch. The most one transfer may be, in cedis. A payout above it becomes `HELD`, raises one Sentry alert and an admin notice, and is paid by hand; it is never split or retried. Unset or not a positive number: nothing is held for its size. The check sits inside `initiateHostPayout`, so it covers short stays too.
- `?dryRun=1` on any cron URL forces a report-only run whatever the switches say.

Rules worth knowing:
- The payout job pays short stays that are `CONFIRMED` or `COMPLETED`, so the order the two jobs run in does not matter.
- One payout per booking, or per rent instalment, is enforced by a unique index on `Payout(bookingId, instalmentSeq)`. `instalmentSeq` is 0 (never null) on a whole-booking payout, because nulls would not count as equal.
- A host with no verified payout method is skipped and retried every hour; the host payouts page shows the amount waiting, and Sentry is alerted once a day once a payout is 7 days overdue.
- A guest cannot cancel online once the check-in day has arrived or a payout exists (`src/lib/cancelRules.ts`).
- A cancelled or refunded booking is never paid out (guard in `initiateHostPayout`).
- Still not built: payouts for a monthly or long-term stay made before instalments existed (it has no `Instalment` rows), refunds after check-in outside a dispute (support handles these by hand), host cancellation penalties, and returning the damage deposit after check-out (done by hand).

Before turning payouts or refunds on: confirm in the Paystack dashboard that transfers are enabled and OTP for transfers is off, check Paystack's refund rules for mobile money, point the Paystack webhook at the real domain (it carries transfer, refund and payment events), and run the launch clean of test bookings (delete `Refund` rows before `Payment` and `Booking`).

## Rent instalments (monthly and long-term stays)

- The rules are one pure file, `src/lib/rentRules.ts`. A monthly or long-term booking gets its `Instalment` rows when it is made (`POST /api/bookings`). The first covers the months paid up front and carries the damage deposit; each later one covers one month and is due the day that month starts (12:00 UTC, counted from the move-in day). The amounts add up to `Booking.subtotal` to the cent. Short stays have none.
- A booking with no `Instalment` rows is paid in one payment, as before. That includes the two long-stay bookings that existed before this was built, which are left exactly as they were.
- The advance: long-term defaults to 3 months and a host can set 1 to 6 (`Listing.advanceMonthsRequired`, `MAX_ADVANCE_MONTHS`). A tenancy of 6 months or less is capped at 2. A monthly booking pays 1. The listing routes refuse anything outside 1 to 6, and the booking route clamps again from the stored value. (Long-term is always booked for 12 months today, so the 2-month cap cannot trigger yet.)
- `Booking.subtotal` and `totalPrice` are for the whole tenancy. What is due now is instalment 1. The price is still yearly (`priceAnnual`) and shown per month as yearly / 12. No service fee line.
- Paying: `POST /api/payments` takes an optional `instalmentId` and charges exactly what is owed on it. A later instalment can be paid only from the move-in day (Ghana date), only the earliest one owed, and never in part. The pay link is `/checkout/[bookingId]?instalment=[id]`. Nothing is charged automatically.
- `settlePayment` is still the one place anything is marked paid. The first instalment's payment confirms the booking and marks the instalment `PAID` in the same transaction. A later one marks only its instalment. A second payment on a settled instalment is `DUPLICATE`; rent that lands on a cancelled or ended tenancy is a `LATE_PAYMENT` refund.
- Payouts: one per settled instalment, through the same `process-payouts` job and `initiateHostPayout`, for `hostShare` of the rent (never the deposit). Instalment 1 is released 48 hours after move-in; each later one on the later of the day it was paid and its due date. The same holds apply as for short stays.
- `rent-reminders` runs daily at 08:00 UTC (`src/lib/rentReminders.ts`): 3 days before, on the day, then daily from the day after the 1-day grace until 14 days after the due date, then it stops and the admins are told once. The host and admins hear once when a payment first becomes late. Before chasing, it asks Paystack (read-only) about any open payment on the instalment and settles it.
- Covering from the deposit: admin Rent tab, `POST /api/admin/rent`, `src/lib/depositCover.ts`. It takes the smaller of what is owed and the deposit left; a shortfall stays owed (`PART_COVERED`) and the tenant pays the rest in one payment. The record is on the instalment (`coveredFromDeposit`, `coveredById`, `coveredAt`). The host is paid for an instalment only once it is settled in full; if a part-covered one never is, the covered share is paid by hand.
- Ending a tenancy: the host or an admin (`end-tenancy` on `PATCH /api/bookings/[id]`), after move-in. `checkOut` moves to the end of the last month paid or covered, the agreed date is kept in `originalCheckOut`, the months not paid are `CANCELLED`, and nothing is refunded. A tenant who leaves early goes through support; nothing is refunded automatically.
- Cancelling before move-in works the refund out from the rent in the first payment, not the whole tenancy, and cancels the instalments. A dispute is decided on the first payment and what is left of the deposit; a full refund also cancels the rent still owed. One refund per booking still holds: a second one is an alert and a by-hand job.
- Admin revenue counts the rent actually received on a booking paid in instalments.

## Fees

- Two rates, both in `src/lib/utils.ts`: `SERVICE_FEE_RATE` (0: guests pay no service fee) and `PLATFORM_COMMISSION` (0.10, taken from the host's payout, so a host keeps 90% of the rent). Nothing else in the code states a percentage.
- Sums read the constants through `calculateFees`, `hostShare` and `hostCommission` (`src/lib/disputes.ts`). Every sentence and figure on the site that states a fee is built from them in `src/lib/fees.ts`.
- A booking stores its service fee in dollars, so a booking made at an older rate still shows and refunds the fee it was charged. A "Service fee" line appears only where the stored fee is above zero.
- The commission is not stored. A payout is worked out at the rate in force when it is made, so changing the rate changes the payout of every booking not yet paid out.
- Admin revenue is counted from stay prices of paid, standing bookings. Damage deposits are never counted.

## Payments and unpaid bookings

- A booking is marked paid in one place, `settlePayment` in `src/lib/paymentSettle.ts`. The verify route (the guest's browser coming back), the `charge.success` webhook, the expiry job and the rent reminder job all call it, in any order or twice, and it confirms once. A rent instalment is settled there too (see Rent instalments).
- It refuses a charge whose reference, amount (pesewas) or currency (GHS) does not match the stored `Payment`: the payment becomes `MISMATCH` and Sentry is alerted. A second successful payment on one booking becomes `DUPLICATE`, alerts, and is refunded by hand.
- Success wins over failed. A payment still in progress at Paystack stays `PENDING` and the guest sees "still processing".
- Money that lands on a cancelled, declined or expired booking, or on a request the host has not accepted, is recorded as a `LATE_PAYMENT` refund in full; the booking is never revived.
- A request (`PENDING`) cannot be paid: "The host needs to accept your request first." Accepting it gives the guest 24 hours. An instant booking has one hour. The deadline is `Booking.payBy` (`src/lib/payDeadline.ts`), never later than the end of the check-in day, and a payment cannot be started after it.
- `expire-bookings` runs every 15 minutes (`src/lib/bookingExpiry.ts`). It acts 15 minutes after `payBy`, and on requests unanswered after 48 hours or the end of the check-in day. Before ending a booking it asks Paystack (read-only) about each payment still open and settles it; if Paystack cannot be reached or a payment is still in progress, the booking waits for the next run.
- An ended booking is `CANCELLED` with `cancelledBy: 'SYSTEM'` and reason `UNPAID_EXPIRED` or `NO_HOST_RESPONSE`. Bookings with no `payBy` (made before deadlines existed) are never ended for being unpaid.
- Before turning the webhook on: set the webhook URL in the Paystack dashboard (test and live each have their own), make one test payment with the switch off, and read the "would confirm" line in the logs.

## Messaging (email, SMS, in-app)

- One call tells people about an event: `notify('booking.confirmed', { bookingId })` in `src/lib/messaging/notify.ts`. Call sites pass IDs only; the facts are read from the database (`events.ts`) and the words come from one registry (`templates.ts`).
- `notify` only writes rows to `MessageLog` (and an in-app `Notification` for events that had none before). It runs after the response, never throws, and is called after the action has committed. It never calls a provider.
- `send-messages` runs every minute (`deliver.ts`) and is the only place a provider adapter is called. A refusal is retried at 5 minutes, 30 minutes and 2 hours, then given up with a Sentry alert. Anything unsure (a throw, a timeout, a run that died) is closed as `UNKNOWN` and never retried, so nothing can be sent twice. A message older than 24 hours is dropped.
- **Off by default.** `MESSAGING_ENABLED` must be exactly `true`, and `EMAIL_PROVIDER` / `SMS_PROVIDER` must name an adapter, per channel. Otherwise every message is recorded as `LOGGED` and nothing leaves; a message logged while off is never sent later. None of these is set in `.env` or on Vercel.
- Adapters live in `src/lib/messaging/providers`, behind one interface (`types.ts`): the log-only adapter, a drill adapter that refuses everything (`fail-drill-email`, `fail-drill-sms`), and `resend` for real email. There is no real SMS adapter. Adding Arkesel or Postmark is one file plus one line in `providers/index.ts`.
- Resend (`providers/resend.ts`) sends only with `MESSAGING_ENABLED=true` and `EMAIL_PROVIDER=resend`. It calls Resend's HTTP API with `fetch` and passes the row's `dedupeKey` as `Idempotency-Key`. A 2xx is `SENT` with Resend's id in `providerMessageId`; a 429 or 5xx is `FAILED` and retried; any other refusal is `GAVE_UP` at once; a timeout, a network error or a 409 is `UNKNOWN` and never retried.
- `RESEND_API_KEY` is read from the environment inside the adapter only. It is never logged, stored in `MessageLog` or put in error text. Missing while switched on: no call is made and the email is retried, then given up with an alert.
- `npm run email:test -- you@example.com --confirm` (`scripts/send-test-email.ts`) sends one real test email through the adapter. It ignores the switches, writes nothing to the database, and refuses without `--confirm`. Never run it from Claude Code.
- Each row has a unique `dedupeKey` (event, occurrence, person, channel), so a job or webhook that fires twice writes nothing the second time.
- The log stores the user id and a masked address only. The real address is read from `User` when the message is sent. Console and Sentry get IDs only.
- SMS is for nine messages, plus the three rent reminders to a tenant (due soon, due today, late): a new request (host), request accepted (guest), booking paid and confirmed (guest and host), the other side cancelled (guest or host), payout sent, payout waiting, and payout method changed. One plain 160-character segment, cedis written "GHS", no names or account details.
- Optional emails (new messages, review prompts, reviews received, welcome notes) can be turned off on the profile page (`User.optionalEmails`). Everything else is always sent. No marketing.
- Admin emails go to one shared inbox, `ADMIN_ALERT_EMAIL`; unset means they are `SKIPPED`. Sender values: `EMAIL_FROM` (the whole From line, default `FieGH <support@fiegh.com>`), `SUPPORT_EMAIL` (reply-to, default `support@fiegh.com`), `SMS_SENDER_ID`.
- The admin page has a Messages tab: the log, and a preview of every template with sample data.
- The five older in-app notices (host cancelled, dispute raised, replied and resolved, payout method changed) are still written where they always were.
- Emails are stored trimmed and lower-cased (`normalizeEmail` in `src/lib/utils.ts`). Nothing verifies that an address or number belongs to the person yet, and there is no password reset.
- `AT_API_KEY` and `AT_USERNAME` are not used by any code.

## Roles and host-only routes

- One helper file, `src/lib/roles.ts`: `requireHost()` and `requireAdmin()` for API routes (401 signed out, 403 otherwise), and `hostAreaRedirect()` for pages. The role is read from the database on every request, so a guest who becomes a host is a host on the next request.
- Every page under `/dashboard/host` is checked on the server by `src/app/dashboard/host/layout.tsx`: a guest goes to `/become-a-host`, an admin to `/admin`, a missing or expired session to log in.
- Host-only API routes call `requireHost()` first and then their own ownership check: listing create, edit, switch off, photos, calendar, a host's bookings, accept, decline, host cancellation, payout history, payout method and the bank list.
- Admins keep access only where they had it: editing or switching off a listing, its calendar, and reading a host's bookings (`requireHost({ allowAdmin: true })`).
- `GET /api/listings?hostId=` returns switched-off and held listings only to that host or an admin. Everyone else gets the public ones.
- Routes shared by guests and hosts (disputes, reviews, messages, the cancellation preview, notifications) check that the person is a party to the booking, not their role.

## Disputes

- Rules are in `src/lib/disputes.ts`; applying a decision is `src/lib/disputeDecisions.ts`. One dispute per side per booking (unique index on `Dispute(bookingId, raisedByRole)`); the other party replies once.
- A guest can report on the check-in day or the day after (Ghana dates). A host can report on the check-out day or the two days after, about the deposit.
- The short-stay payout is 48 hours after check-in (`PAYOUT_DELAY_MS` in `src/lib/cronRuns.ts`), so it never goes out while the guest's window is open. An open guest dispute holds the payout in the job's query and in `initiateHostPayout`.
- Guest outcomes: full refund (no payout), partial refund from the stay price only (the host is paid their share of what is left: the stay price less the commission), or rejected (paid as normal). Host outcomes: deposit returned, deposit kept (recorded; paid to the host by hand), or rejected. Decisions are final; mistakes are fixed by hand and written to the dispute as a correction.
- Refund reasons added: `DISPUTE_FULL`, `DISPUTE_PARTIAL`, `DISPUTE_DEPOSIT`. The last two still allow a host payout.
- Evidence: up to 6 photos a side, 5MB, JPEG/PNG/WebP, in the private `dispute-evidence` bucket, read only through 10-minute signed links by the two parties and admins.
- In-app notices (`Notification` rows) are shown on the guest dashboard, host dashboard and admin overview. Emails for the same events go through `notify` (see Messaging) and are only logged until messaging is switched on.
- `check-disputes` runs daily at 09:00 UTC and sends one Sentry alert per dispute still open after 3 days. The site says "we aim to decide within 3 working days", as an aim only.
- The `DISPUTED` booking status is not used.

## Cancellation policies and refunds

- The rules are one table in `src/lib/cancellationPolicy.ts`: Flexible, Moderate and Strict, with different notice periods for short stays, monthly stays and long-term rentals. Every page that states a policy builds its sentences from that table, so wording cannot drift from the sums.
- Guests pay no service fee on new bookings. A booking made when there was one stores it, and it is refunded only when the whole stay price is refunded. The damage deposit is always refunded on a cancellation before check-in. For monthly and long-term stays the amount kept is never more than one month's rent. FieGH absorbs Paystack's fee.
- New listings default to Moderate (in code; the database column default is still `FLEXIBLE`). The policy is copied onto the booking when it is made (`Booking.cancellationPolicy`).
- The refund is worked out on the server from stored values (`src/lib/cancellation.ts`), never from the request. The cancel request carries the amount the person was shown only so the server can refuse if it has changed.
- One refund per booking (unique index on `Refund.bookingId`). `Payment.amountPesewas` and `usdToGhs` are saved at charge time so a refund returns the same share of the cedis paid.
- A host can cancel a confirmed booking up to the day before check-in with a required reason; the guest gets everything back, every admin is notified, and the admin page counts them. No penalties yet.
- A payment that lands on a cancelled or declined booking is refunded in full and does not revive it.

## Key Technical Decisions & Why
- **MapTiler over Mapbox** — avoids Mapbox's credit card requirement during development
- **Paystack over direct MTN MoMo API** — covers all three Ghanaian mobile money networks plus cards, stronger docs, settles to Ghana bank accounts

## Working Preferences
- Prefer direct, concrete fixes with specific values/file paths over abstract suggestions
- Plain-English explanations welcome when asked, but default to just doing the work
