# FieGH 🏠🇬🇭

> **"Fie" means home in Twi.** — *Your home in Ghana.*

FieGH is Ghana's premier full-stack rental marketplace combining short-term holiday stays (like Airbnb), monthly temporary rentals, and long-term leases — all in one platform built specifically for the Ghanaian market.

---

## Features

### Three Rental Modes
- 🌙 **Short Stay** — Nightly/weekly bookings (Detty December, business travel, tourism)
- 📅 **Temporary Stay** — Monthly rentals, 1–11 months (relocation, diaspora visits, students)
- 🏠 **Permanent Rental** — 12+ months with tenancy agreements and clear advance payment terms

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
- All users require ID verification before booking/listing
- Trust scores calculated from verification, reviews, and booking history
- Scam prevention: contact details in descriptions auto-flagged for admin review
- Report listing / report user buttons
- Paystack-powered escrow

### Admin Panel
- User management (verify, suspend accounts)
- Listing management (approve, reject, flag)
- Booking oversight
- Verification queue
- Exchange rate updater (USD → GHS)
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
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="your-secret"
NEXTAUTH_URL="http://localhost:3000"
PAYSTACK_SECRET_KEY="sk_test_..."
PAYSTACK_PUBLIC_KEY="pk_test_..."
AT_API_KEY="..."          # Africa's Talking (SMS)
AT_USERNAME="sandbox"
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

---

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

1. Switch `DATABASE_URL` to a Postgres connection string (Neon, Supabase, or Render)
2. Run `npx prisma migrate deploy`
3. Set all environment variables on your hosting platform
4. Add Paystack webhook URL: `https://yourdomain.com/api/payments`
5. Deploy to Vercel, Railway, or Render

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

MIT — Built with ❤️ in Ghana 🇬🇭

*"Your home in Ghana"*
