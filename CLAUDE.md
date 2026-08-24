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
5. Hosting setup and environment configuration
6. Security hardening
7. Error monitoring
8. End-to-end testing
9. Legal documentation

## Key Technical Decisions & Why
- **MapTiler over Mapbox** — avoids Mapbox's credit card requirement during development
- **Paystack over direct MTN MoMo API** — covers all three Ghanaian mobile money networks plus cards, stronger docs, settles to Ghana bank accounts

## Working Preferences
- Prefer direct, concrete fixes with specific values/file paths over abstract suggestions
- Update `FIEGH-CHECKLIST.md` in this repo as tasks are completed — treat it as the source of truth for progress tracking
- Plain-English explanations welcome when asked, but default to just doing the work
