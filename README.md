# FieGH

> **"Fie" means home in Twi.** — *Your home in Ghana.*

FieGH is Ghana's premier full-stack rental marketplace combining short-term holiday stays (like Airbnb), monthly temporary rentals, and long-term leases — all in one platform built specifically for the Ghanaian market.

---

## Features

### Three Rental Modes
- **Short Stay** — Nightly/weekly bookings (Detty December, business travel, tourism)
- **Temporary Stay** — Monthly rentals, 1–11 months (relocation, diaspora visits, students)
- **Permanent Rental** — 12+ months with tenancy agreements and clear advance payment terms

Monthly and long-term stays are paid in instalments: the months paid up front and the deposit first, then month by month through a pay link, with reminders. Nothing is charged automatically.

### For Guests
- Sign up with Ghana phone number or email
- Ghana Card / Passport / Voter ID verification
- Search by rental mode, region, price, amenities
- Instant Book or Request to Book
- Pay via MTN MoMo, Vodafone Cash, AirtelTigo Money, or Visa/Mastercard (Paystack)
- Escrow protection — funds held until check-in confirmed
- Dispute system (24-hour window after check-in)
- Messaging with hosts, booking history, wishlist

### For Hosts
- List apartments, houses, villas, studios, entire compounds, and more
- Set pricing per mode (nightly / monthly / annual)
- Advance payment requirement field for permanent rentals
- Full calendar management + availability blocking
- Instant Book toggle or manual approval
- Damage deposit option
- Host dashboard with earnings, occupancy, payout history
- Superhost badge (auto-awarded at 4.8+ rating, 10+ reviews)

### Trust & Safety
- Hosts need an approved ID before they can be paid; no one needs one to book or list
- Trust scores calculated from verification, reviews, and booking history
- Scam prevention: contact details in descriptions auto-flagged for admin review
- Report listing / report user buttons
- Paystack-powered escrow

### Admin Panel
- User management (verify, suspend accounts)
- Listing management (approve, reject, flag)
- Booking oversight
- Verification queue
- Exchange rate updater (USD to GHS)
- Platform analytics

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 + Custom CSS variables |
| Animation | GSAP (hero, scroll-triggered sections) |
| Database | Prisma ORM + SQLite (dev) / PostgreSQL (prod) |
| Auth | Custom session-based auth (cookie sessions) |
| Payments | Paystack (Ghana cards + MoMo) |
| Icons | Lucide React |
| Fonts | Playfair Display + DM Sans |

---

## Colour Palette

| Name | Hex | Usage |
|------|-----|-------|
| Deep Brown | `#1A1208` | Primary dark, navbar, footer |
| Warm Gold | `#F5C06A` | Accents, highlights |
| Amber | `#C8873F` | CTAs, buttons |
| Cream | `#FAF7F2` | Background |

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env .env.local
# Edit .env.local with your actual keys

# 3. Set up the database
npx prisma db push

# 4. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

```env
DATABASE_URL="postgresql://…"   # see "Production database" below and .env.example
DIRECT_URL="postgresql://…"     # migrations and the Prisma CLI only
NEXTAUTH_SECRET="your-secret"
NEXTAUTH_URL="http://localhost:3000"
PAYSTACK_SECRET_KEY="sk_test_..."
PAYSTACK_PUBLIC_KEY="pk_test_..."
AT_API_KEY="..."          # Africa's Talking: not used by any code
AT_USERNAME="sandbox"     # not used by any code
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

---

### Payout, completion and refund switches

The hourly cron jobs are off until switched on. Leave these unset until launch (see `.env.example` and CLAUDE.md):

- `PAYOUTS_ENABLED`: must be exactly `true` before any transfer to a host is attempted. Otherwise the payout job only reports what it would do.
- `PAYOUTS_NOT_BEFORE`: a date (`YYYY-MM-DD`). Only bookings created on or after it can be paid out. Required for payouts to run.
- `COMPLETION_ENABLED`: must be exactly `true` before bookings are marked completed.
- `REFUNDS_ENABLED`: must be exactly `true` before any refund is sent to Paystack. While off, cancelling still works and the refund is recorded as owed.
- `DISPUTE_DECISIONS_ENABLED`: must be exactly `true` before an admin's decision on a dispute takes effect. While off, deciding only reports what it would do. Reporting a problem and holding the payout are always on.
- `PAYMENT_WEBHOOK_ENABLED`: must be exactly `true` before Paystack's `charge.success` webhook confirms a payment. While off, the event is signature-checked and logged as what it would do, and nothing is written.
- `BOOKING_EXPIRY_ENABLED`: must be exactly `true` before the expiry job ends unpaid bookings and unanswered requests. While off, it only reports and never calls Paystack.
- `BOOKING_EXPIRY_NOT_BEFORE`: a date (`YYYY-MM-DD`). Only bookings created on or after it can be ended by the expiry job. Required for the job to run.
- `RENT_REMINDERS_ENABLED`: must be exactly `true` before the daily rent reminder job writes any reminder. While off, it only reports and never calls Paystack.
- `RENT_DEPOSIT_COVER_ENABLED`: must be exactly `true` before an admin can cover a missed rent payment from the damage deposit. While off, the button only reports what it would do.
- No switch, always on: a host is paid only once an admin has approved their ID. Until then their payouts wait (nothing is failed or lost) and go out on the first run after approval. See `src/lib/hostId.ts`.
- `PAYOUT_LIMIT_GHS`: not a switch. The most one transfer to a host may be, in cedis. A payout above it is held for a person and an alert is raised; it is never split or retried. Unset: nothing is held for its size.

Add `?dryRun=1` to any cron URL for a report-only run.

### Messaging (email and SMS)

Nothing is sent until it is switched on. Leave these unset until a provider account exists (see `.env.example` and CLAUDE.md):

- `MESSAGING_ENABLED`: must be exactly `true` before anything can be sent. While off, every message is still recorded in the message log (admin page, Messages tab) as `LOGGED`, and is never sent later.
- `EMAIL_PROVIDER`, `SMS_PROVIDER`: the adapter each channel sends through. Unset (or `log`) means that channel only logs. `resend` is the one real email adapter: real email goes out only with `MESSAGING_ENABLED=true` and `EMAIL_PROVIDER=resend`. `arkesel` is the one real SMS adapter: real SMS goes out only with `MESSAGING_ENABLED=true` and `SMS_PROVIDER=arkesel`.
- `RESEND_API_KEY`: the Resend API key. Read from the environment only; never logged or stored. If it is missing while email is switched on, nothing is called and each email is retried, then given up with an alert.
- `EMAIL_FROM`: the whole From line. Default `FieGH <support@fiegh.com>`. The address must be on a domain verified in Resend.
- `SUPPORT_EMAIL`, `SMS_SENDER_ID`: the reply-to (also shown in messages) and the SMS sender name. Defaults are support@fiegh.com and FieGH. The sender name must be the one Arkesel has approved (1 to 11 letters, digits or spaces).
- `ARKESEL_API_KEY`: the Arkesel SMS API key. Read from the environment only; never logged or stored. If it is missing while SMS is switched on, nothing is called and each SMS is retried, then given up with an alert.
- `SMS_WEBHOOK_SECRET`: 32 or more random characters. With it, each SMS asks Arkesel for a delivery report on its own signed link (`/api/webhooks/sms/arkesel/<id>/<signature>`), and the Messages tab shows Delivered or Not delivered. Without it no report is asked for.
- `SMS_LOW_BALANCE_ALERT`: a number of SMS credits. The hourly `sms-balance` job raises one alert a day while the Arkesel balance is below it. It calls Arkesel only while SMS is switched on through Arkesel.
- `ADMIN_ALERT_EMAIL`: one shared inbox for everything admins are emailed about. Unset: each admin account that has an email address is sent it instead. With neither, the email is skipped; the in-app notices still appear.
- `SUPPORT_PHONE`: the support phone number shown in the footer. Unset: no phone number is shown. A placeholder is never shown.

To send one test email or SMS by hand before switching anything on: `npm run email:test -- you@example.com --confirm`, and `npm run sms:test -- 0XXXXXXXXX --confirm --sandbox` (Arkesel's sandbox: not delivered, not charged), then without `--sandbox` for one real SMS. Both ignore the switches and write nothing to the database.

#### Before turning SMS on

1. Open an Arkesel account (account.arkesel.com) and verify its phone number and email.
2. Ask Arkesel to register the sender ID `FieGH` (or the name in `SMS_SENDER_ID`) for transactional messages, and wait for the networks to approve it. Messages from an unregistered sender ID are blocked, and MTN blocks unregistered international sender IDs.
3. Top up SMS credit (Recharge, Purchase SMS plan).
4. Create the API key (SMS API page) and set `ARKESEL_API_KEY`, `SMS_WEBHOOK_SECRET` and `SMS_LOW_BALANCE_ALERT` on Vercel. Nothing needs to be set in Arkesel for delivery reports: each SMS carries its own report link, which must be reachable at the real domain (`NEXTAUTH_URL`).
5. Run `npm run sms:test -- 0XXXXXXXXX --confirm --sandbox`, then once without `--sandbox` to a phone you hold.
6. Only then set `SMS_PROVIDER=arkesel` (with `MESSAGING_ENABLED=true`).

The drill adapters (`fail-drill-email`, `fail-drill-sms`) are for rehearsing failures and are test-only. They cannot be selected in production (`NODE_ENV=production` or `VERCEL_ENV=production`): naming one there sends nothing and raises a Sentry alert.

### Listing checks and digital addresses

- A host can add a Ghana Post digital address (for example `GA-183-8164`) to a listing. It is optional and never shown publicly: a guest sees it on their booking once the booking is confirmed and paid.
- An admin can record that FieGH checked a listing's address and photos (admin page, "Listing checks" tab). The listing then shows "Address and photos checked" for 12 months. That is all it claims: it is not proof of who owns the home and not a guarantee. The wording lives in `src/lib/listingCheckRules.ts`.
- The badge disappears on its expiry date by itself, and at once if the host changes the address, property type, bedrooms or photos, or the listing is put on hold.
- The cron job `listing-check-reminders` emails the host once, 30 days before a check runs out. No new environment variable is needed.

### Accounts: email confirmation and password reset

- Signing up sends a link to confirm the email address. Changing an email sends the link to the new address and tells the old one; the old email stays in force until the link is followed. "Forgot your password?" on the login page emails a reset link.
- Links are single-use and expire (24 hours; one hour for a password reset). Only a hash of each token is stored. Requests are limited per person and per IP address, and the answer is the same whether or not an address has an account.
- `EMAIL_VERIFICATION_REQUIRED`: must be exactly `true` before an unconfirmed account is held back from booking, listing a home or paying. Browsing is never held back. Leave it unset until email is really being sent (`MESSAGING_ENABLED=true` and `EMAIL_PROVIDER=resend`), or nobody new could confirm.
- `NEXTAUTH_SECRET` must be set (16 characters or more): link emails are stored encrypted with a key derived from it until they are sent.

To send one test email by hand, before switching anything on:

```
npm run email:test -- you@example.com --confirm
```

It sends a real email through Resend to that address, so it refuses without `--confirm`, a valid address and `RESEND_API_KEY` (from the environment or `.env`). It writes nothing to the database and ignores `MESSAGING_ENABLED` and `EMAIL_PROVIDER`.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with GSAP hero, featured listings, regions |
| `/search` | Search with filters (mode, region, price, amenities) |
| `/listings/[id]` | Property detail page with booking widget |
| `/auth/signin` | Sign in (phone or email) |
| `/auth/signup` | Sign up (guest or host role) |
| `/auth/verify-id` | ID verification upload |
| `/dashboard/guest` | Guest dashboard (bookings, wishlist) |
| `/dashboard/host` | Host dashboard (listings, earnings, bookings) |
| `/dashboard/host/listings/new` | 6-step listing creation wizard |
| `/admin` | Admin panel (users, listings, verifications, settings) |
| `/how-it-works` | Guide for guests and hosts |
| `/faq` | Accordion FAQ |
| `/terms` | Terms of Service |
| `/privacy` | Privacy Policy |

---

## API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/signup` | POST | Create user account |
| `/api/auth/signin` | POST | Sign in, set session cookie |
| `/api/listings` | GET | Search/filter listings |
| `/api/listings` | POST | Create a listing |
| `/api/bookings` | POST | Create a booking (double-booking protected) |
| `/api/bookings` | GET | Get bookings by guest or host |
| `/api/payments` | POST | Initiate Paystack payment |
| `/api/payments` | PUT | Verify payment (webhook) |

---

## Production Deployment

Vercel (Pro) in front of Supabase Postgres.

### Region

The database is in Supabase's `eu-west-1` (Ireland). The functions run next to it, in Vercel's Dublin region: `"regions": ["dub1"]` in `vercel.json`. Every API call makes several database round trips one after another, so the distance between the two is multiplied into every response (second go, Stage C). Change both together if either moves.

### Production database

| Variable | Used by | Value |
|---|---|---|
| `DATABASE_URL` | the app | Supabase's pooler in transaction mode, port 6543, with `pgbouncer=true&connection_limit=1`: `postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | migrations and the Prisma CLI only, never the app | the direct host, `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres` (IPv6 only), or from a network without IPv6 the pooler in session mode (same pooler host, port 5432, no `pgbouncer=true`) |

`connection_limit=1`: each server instance holds one connection to the pooler, so capacity is set by the pooler's size for the Supabase plan, and many instances cannot use up its client limit. Watch connection counts in the Supabase dashboard in the first weeks.

Schema changes are not run from a deploy: they are written as exact SQL, reviewed, and run by hand (see `CLAUDE.md`).

### Before the first deploy

1. Set every variable from `.env.example` on Vercel (Production), with `NEXTAUTH_URL` the real https address.
2. Point the Paystack webhook at `https://<domain>/api/webhooks/paystack` (test and live each have their own).
3. Supabase on a paid plan: the free tier pauses after 7 days without use.

---

## Roadmap

- [ ] Real-time chat (Supabase Realtime or Pusher)
- [ ] Map view (Mapbox) for search results
- [ ] Image upload (Cloudinary integration)
- [ ] SMS notifications (Africa's Talking)
- [ ] PDF tenancy agreement generation
- [ ] Stripe/Paystack full integration + webhooks
- [ ] Automated Superhost badge cron job
- [ ] Mobile app (React Native)

---

## License

MIT. Built with love in Ghana.

*"Your home in Ghana"*
