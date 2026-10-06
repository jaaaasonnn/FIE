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

## Payout and completion switches

The two hourly cron jobs do nothing risky until they are switched on in the environment. All three variables are **off when unset**, and none is set in `.env` or on Vercel yet. Names and notes are in `.env.example`; the code is `src/lib/payoutSwitches.ts` and `src/lib/cronRuns.ts`.

- `PAYOUTS_ENABLED`: must be exactly `true` before any Paystack transfer is attempted. Otherwise `process-payouts` runs as a dry run: it reports what it would pay, writes nothing and calls nothing. The same check sits inside `initiateHostPayout`, so no other caller can start a transfer.
- `PAYOUTS_NOT_BEFORE`: a date (`YYYY-MM-DD`, UTC). Only bookings created on or after it can ever be paid out. Required: without a valid date, payouts stay in dry run even when enabled. Set it to the launch date so no test booking is ever paid.
- `COMPLETION_ENABLED`: must be exactly `true` before `complete-bookings` marks anything `COMPLETED`.
- `?dryRun=1` on either cron URL forces a report-only run whatever the switches say.

Rules worth knowing:
- The payout job pays short stays that are `CONFIRMED` or `COMPLETED`, so the order the two jobs run in does not matter.
- One payout per booking is enforced by a unique index on `Payout.bookingId`.
- A host with no verified payout method is skipped and retried every hour; the host payouts page shows the amount waiting, and Sentry is alerted once a day once a payout is 7 days overdue.
- A guest cannot cancel online once the check-in day has arrived or a payout exists (`src/lib/cancelRules.ts`).
- Still not built: payouts for monthly and long-term stays, refunds, disputes, and returning the damage deposit.

Before turning payouts on: confirm in the Paystack dashboard that transfers are enabled and OTP for transfers is off, point the Paystack webhook at the real domain, and run the launch clean of test bookings.

## Key Technical Decisions & Why
- **MapTiler over Mapbox** — avoids Mapbox's credit card requirement during development
- **Paystack over direct MTN MoMo API** — covers all three Ghanaian mobile money networks plus cards, stronger docs, settles to Ghana bank accounts

## Working Preferences
- Prefer direct, concrete fixes with specific values/file paths over abstract suggestions
- Update `FIEGH-CHECKLIST.md` in this repo as tasks are completed — treat it as the source of truth for progress tracking
- Plain-English explanations welcome when asked, but default to just doing the work
