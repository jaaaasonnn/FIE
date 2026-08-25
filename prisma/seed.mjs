/**
 * prisma/seed.mjs
 *
 * Inserts demo hosts, guests, admins, verifications, and listings.
 *
 * Run with:
 *   npm run db:seed
 *
 * Safe to run any time, including against an already-seeded DB: every
 * row here is upserted by a deterministic id (stableId(...) below), so
 * a normal re-run just syncs this file's current field values (title,
 * photos, price, etc.) onto the existing rows — no flag needed. It can
 * never create duplicates or touch a real user/listing, since those
 * have ordinary cuid ids that a stableId(...) value will never collide
 * with.
 *
 * Optional: npm run db:seed -- --force
 *   Prunes seed-owned listings/verifications/users first and recreates
 *   them from scratch. Only useful if you've removed an entry from
 *   this file and want its now-stale DB row actually gone, rather than
 *   just left untouched by the upsert above — the normal run doesn't
 *   need this for ordinary field edits (title, photos, price, ...).
 *   Scoped strictly to rows whose id starts with the 'seed_' prefix
 *   that stableId(...) always generates — NOT by e.g. host/user email
 *   domain, which would also catch real listings/bookings created by
 *   manually testing the app while logged in as a seed account (this
 *   DB has several: "Test Create Listing Fix", "Photo Upload Test
 *   Listing", etc., all with ordinary cuid ids, all owned by seed
 *   hosts). The id prefix can't have that false-positive problem — it
 *   only ever matches rows this script itself created — so --force can
 *   never delete a real listing or user. If a seed listing still has
 *   real bookings against it, the database's own foreign-key
 *   constraint (Booking.listingId) refuses the delete rather than
 *   cascading through and losing that booking data — seeing --force
 *   fail loudly in that case is the intended behavior, not a bug.
 *
 * All @fiegh.demo accounts share password: Demo1234!
 */

import { PrismaClient }  from '@prisma/client'
import { createHash }    from 'node:crypto'
import bcrypt            from 'bcryptjs'
import { createClient }  from '@supabase/supabase-js'
import { WebSocket }     from 'ws'
import sharp              from 'sharp'

// Same polyfill lib/supabase.ts needs — supabase-js spins up a Realtime
// client internally even though we only use Storage here, and Node 20
// doesn't provide a global WebSocket constructor.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket
}

const db    = new PrismaClient()
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)
const VERIFICATION_DOCS_BUCKET = 'verification-docs'
const force = process.argv.includes('--force')

/** Shared demo password for every @fiegh.demo account */
const DEMO_PASSWORD = 'Demo1234!'

// ── Deterministic CUID-like IDs so links stay stable across re-seeds ────────
// We derive stable IDs from a short key so the URLs in the app never break.
function stableId(key) {
  return 'seed_' + createHash('md5').update(key).digest('hex').slice(0, 20)
}

const HOST_ABENA   = stableId('host-abena-mensah')
const HOST_KWESI   = stableId('host-kwesi-boateng')
const HOST_AKOSUA  = stableId('host-akosua-darko')
const GUEST_KOFI   = stableId('guest-kofi-asante')
const ADMIN_AMA    = stableId('admin-ama-owusu')
const ADMIN_YAW    = stableId('admin-yaw-mensah')
const GUEST_EFUA   = stableId('guest-efua-adjei')
const GUEST_KOJO   = stableId('guest-kojo-appiah')
const HOST_NANA    = stableId('host-nana-serwaa')

// ── Admins (for /admin panel testing) ───────────────────────────────────────
const ADMINS = [
  {
    id:           ADMIN_AMA,
    name:         'Ama Owusu',
    email:        'admin@fiegh.demo',
    phone:        '+233241000100',
    role:         'ADMIN',
    profilePhoto: 'https://images.unsplash.com/photo-1632678548683-b6c77b8e40bc?w=200&q=80',
    isVerified:   true,
    isSuperhost:  false,
    trustScore:   100,
    businessName: 'FieGH Platform Ops',
  },
  {
    id:           ADMIN_YAW,
    name:         'Yaw Mensah',
    email:        'admin2@fiegh.demo',
    phone:        '+233241000101',
    role:         'ADMIN',
    profilePhoto: 'https://images.unsplash.com/photo-1565884280295-98eb83e41c65?w=200&q=80',
    isVerified:   true,
    isSuperhost:  false,
    trustScore:   100,
    businessName: 'FieGH Trust & Safety',
  },
]

// ── Extra guests / hosts for a fuller Users tab ─────────────────────────────
const EXTRA_USERS = [
  {
    id:           GUEST_EFUA,
    name:         'Efua Adjei',
    email:        'efua@fiegh.demo',
    phone:        '+233245550002',
    role:         'GUEST',
    profilePhoto: 'https://images.unsplash.com/photo-1632612721400-0a337458b7ed?w=200&q=80',
    isVerified:   false,
    isSuperhost:  false,
    trustScore:   45,
    businessName: null,
  },
  {
    id:           GUEST_KOJO,
    name:         'Kojo Appiah',
    email:        'kojo@fiegh.demo',
    phone:        '+233245550003',
    role:         'GUEST',
    profilePhoto: 'https://images.unsplash.com/photo-1614890085618-0e1054da74f8?w=200&q=80',
    isVerified:   true,
    isSuperhost:  false,
    trustScore:   68,
    businessName: null,
  },
  {
    id:           HOST_NANA,
    name:         'Nana Serwaa',
    email:        'nana@fiegh.demo',
    phone:        '+233241000004',
    role:         'HOST',
    profilePhoto: 'https://images.unsplash.com/photo-1620829813887-05646a898447?w=200&q=80',
    isVerified:   false,
    isSuperhost:  false,
    trustScore:   55,
    businessName: 'Serwaa Homes Accra',
  },
]

// ── Hosts ────────────────────────────────────────────────────────────────────
const HOSTS = [
  {
    id:           HOST_ABENA,
    name:         'Abena Mensah',
    email:        'abena@fiegh.demo',
    phone:        '+233241000001',
    role:         'HOST',
    profilePhoto: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&q=80',
    isVerified:   true,
    isSuperhost:  true,
    trustScore:   98,
  },
  {
    id:           HOST_KWESI,
    name:         'Kwesi Boateng',
    email:        'kwesi@fiegh.demo',
    phone:        '+233241000002',
    role:         'HOST',
    profilePhoto: 'https://images.unsplash.com/photo-1625191824973-894292e94c96?w=200&q=80',
    isVerified:   true,
    isSuperhost:  false,
    trustScore:   87,
  },
  {
    id:           HOST_AKOSUA,
    name:         'Akosua Darko',
    email:        'akosua@fiegh.demo',
    phone:        '+233241000003',
    role:         'HOST',
    profilePhoto: 'https://images.unsplash.com/photo-1636754906126-58a76fa5c45a?w=200&q=80',
    isVerified:   true,
    isSuperhost:  false,
    trustScore:   82,
  },
]

// ── Listings ─────────────────────────────────────────────────────────────────
const LISTINGS = [
  {
    id:           stableId('listing-east-legon-3br'),
    hostId:       HOST_ABENA,
    title:        'Luxury 3-Bedroom Apartment in East Legon',
    description:  `Welcome to this beautifully furnished luxury apartment in the heart of East Legon, one of Accra's most prestigious neighbourhoods.

The apartment features modern finishes, a fully equipped kitchen, and stunning city views. Perfect for families, business travellers, or anyone looking for a premium stay in Accra.

The neighbourhood is walkable to restaurants, supermarkets, and the Accra Mall. Airport pickup can be arranged on request.`,
    propertyType:  'Apartment',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'East Legon',
    lat:           5.6354, lng: -0.1667,
    bedrooms: 3, bathrooms: 2, maxGuests: 6,
    rentalModes:  ['SHORT_STAY', 'TEMP_STAY'],
    priceNightly: 120, priceMonthly: 2200, priceAnnual: 24000,
    amenities:    ['WiFi', 'Generator/Inverter', 'Air Conditioning', 'Swimming Pool', 'Parking', 'CCTV', 'Security Guard', 'Furnished', 'Kitchen', 'Prepaid Electricity Meter'],
    rules:        ['No smoking', 'No parties or events', 'No pets', 'Quiet hours after 10pm'],
    photos: [
      'https://images.unsplash.com/photo-1723641879188-fb35552ee084?w=900&q=80',
      'https://images.unsplash.com/photo-1760072513376-67a46aab0fd1?w=900&q=80',
      'https://images.unsplash.com/photo-1768609239321-1cfe14893e80?w=900&q=80',
      'https://images.unsplash.com/photo-1568232033336-8bbd9ff19a9a?w=900&q=80',
    ],
    cancellationPolicy: 'MODERATE',
    instantBook:        true,
    minStayNights:      2,
    damageDeposit:      200,
    avgRating:          4.9,
    reviewCount:        47,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-cantonments-studio'),
    hostId:       HOST_ABENA,
    title:        'Modern Studio in Cantonments',
    description:  'A sleek, minimalist studio in the heart of Cantonments. Fully furnished with high-speed WiFi, air conditioning, and 24-hour CCTV security. Walking distance to embassies and top restaurants.',
    propertyType:  'Studio',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'Cantonments',
    lat:           5.5676, lng: -0.1833,
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    rentalModes:  ['SHORT_STAY'],
    priceNightly: 65, priceMonthly: 900,
    amenities:    ['WiFi', 'Air Conditioning', 'CCTV', 'Furnished', 'Kitchen'],
    rules:        ['No smoking', 'No visitors after midnight'],
    photos: [
      'https://images.unsplash.com/photo-1757862351841-c6f7ac0b0201?w=900&q=80',
      'https://images.unsplash.com/photo-1748679979601-dc9ec43d900d?w=900&q=80',
    ],
    cancellationPolicy: 'FLEXIBLE',
    instantBook:        true,
    minStayNights:      1,
    damageDeposit:      100,
    avgRating:          4.8,
    reviewCount:        23,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-airport-hills-4br'),
    hostId:       HOST_KWESI,
    title:        'Spacious 4-Bedroom House, Airport Hills',
    description:  'A spacious, well-maintained 4-bedroom family home in the quiet Airport Hills estate. Equipped with inverter backup, ample parking, and boys quarters. Ideal for corporate relocations or medium-term stays.',
    propertyType:  'House',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'Airport Hills',
    lat:           5.6033, lng: -0.1654,
    bedrooms: 4, bathrooms: 3, maxGuests: 8,
    rentalModes:  ['TEMP_STAY', 'PERMANENT'],
    priceMonthly: 1800, priceAnnual: 19200,
    advanceMonthsRequired: 3,
    amenities:    ['WiFi', 'Generator/Inverter', 'Parking', 'Boys Quarters', 'CCTV', 'Water Storage Tank'],
    rules:        ['No parties', 'Tenants responsible for utility bills', 'No subletting'],
    photos: [
      'https://images.unsplash.com/photo-1586228046763-cd367fc926bf?w=900&q=80',
      'https://images.unsplash.com/photo-1600489000022-c2086d79f9d4?w=900&q=80',
    ],
    cancellationPolicy: 'MODERATE',
    instantBook:        false,
    minStayNights:      30,
    damageDeposit:      400,
    avgRating:          4.7,
    reviewCount:        12,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-kumasi-nhyiaeso-villa'),
    hostId:       HOST_KWESI,
    title:        'Cosy Villa in Kumasi (Nhyiaeso)',
    description:  'A stunning private villa nestled in Nhyiaeso, one of Kumasi\'s most sought-after neighbourhoods. Features a private pool, lush tropical garden, and gym. Perfect for a luxury Ashanti experience.',
    propertyType:  'Villa',
    region:        'Ashanti',
    city:          'Kumasi',
    neighbourhood: 'Nhyiaeso',
    lat:           6.6930, lng: -1.6234,
    bedrooms: 5, bathrooms: 4, maxGuests: 10,
    rentalModes:  ['SHORT_STAY', 'TEMP_STAY'],
    priceNightly: 200, priceMonthly: 3500,
    amenities:    ['Swimming Pool', 'WiFi', 'Air Conditioning', 'Garden', 'Gym', 'Parking', 'Security Guard'],
    rules:        ['No loud music after 11pm', 'No smoking indoors', 'Pool rules apply'],
    photos: [
      'https://images.unsplash.com/photo-1777052854737-7893f50de539?w=900&q=80',
      'https://images.unsplash.com/photo-1745794621090-d856c53b0cc2?w=900&q=80',
    ],
    cancellationPolicy: 'STRICT',
    instantBook:        true,
    minStayNights:      2,
    damageDeposit:      500,
    avgRating:          5.0,
    reviewCount:        8,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-labone-2br'),
    hostId:       HOST_AKOSUA,
    title:        'Furnished 2-Bedroom Apartment, Labone',
    description:  'A beautifully furnished 2-bedroom apartment in Labone, one of Accra\'s premium residential areas. Fully equipped kitchen, high-speed internet, and secure parking. Great for long-term tenants or corporate stays.',
    propertyType:  'Apartment',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'Labone',
    lat:           5.5641, lng: -0.1768,
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    rentalModes:  ['TEMP_STAY', 'PERMANENT'],
    priceMonthly: 950, priceAnnual: 10200,
    advanceMonthsRequired: 6,
    amenities:    ['WiFi', 'Air Conditioning', 'CCTV', 'Parking', 'Furnished', 'Kitchen', 'Washing Machine'],
    rules:        ['No pets', 'No smoking', 'Quiet hours after 10pm'],
    photos: [
      'https://images.unsplash.com/photo-1723641879188-fb35552ee084?w=900&q=80',
      'https://images.unsplash.com/photo-1757862351841-c6f7ac0b0201?w=900&q=80',
    ],
    cancellationPolicy: 'MODERATE',
    instantBook:        false,
    minStayNights:      30,
    damageDeposit:      300,
    avgRating:          4.6,
    reviewCount:        31,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-osu-guestroom'),
    hostId:       HOST_AKOSUA,
    title:        'Private Guestroom, Osu Oxford Street',
    description:  'A cosy private guestroom steps away from Oxford Street, Osu\'s vibrant hub of restaurants, bars, and shops. Ideal for solo travellers or couples exploring Accra. Shared kitchen access included.',
    propertyType:  'Guestroom',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'Osu',
    lat:           5.5600, lng: -0.1870,
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    rentalModes:  ['SHORT_STAY'],
    priceNightly: 38, priceMonthly: 550,
    amenities:    ['WiFi', 'Air Conditioning', 'Kitchen'],
    rules:        ['No smoking', 'No visitors in room after 10pm'],
    photos: [
      'https://images.unsplash.com/photo-1748679979601-dc9ec43d900d?w=900&q=80',
    ],
    cancellationPolicy: 'FLEXIBLE',
    instantBook:        true,
    minStayNights:      1,
    damageDeposit:      50,
    avgRating:          4.7,
    reviewCount:        55,
    isFeatured:         true,
  },
  {
    id:           stableId('listing-ridge-serviced'),
    hostId:       HOST_KWESI,
    title:        'Serviced Apartment, Ridge',
    description:  'A premium serviced apartment in the diplomatic Ridge area. Hotel-like amenities including pool, gym, and concierge service. Perfect for business travellers and expatriates wanting convenience and security.',
    propertyType:  'Serviced apartment',
    region:        'Greater Accra',
    city:          'Accra',
    neighbourhood: 'Ridge',
    lat:           5.5652, lng: -0.1937,
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    rentalModes:  ['SHORT_STAY', 'TEMP_STAY'],
    priceNightly: 95, priceMonthly: 1400,
    amenities:    ['WiFi', 'Air Conditioning', 'Swimming Pool', 'Gym', 'CCTV', 'Security Guard', 'Parking', 'Furnished'],
    rules:        ['No smoking', 'No parties', 'Pets on request'],
    photos: [
      'https://images.unsplash.com/photo-1568232033336-8bbd9ff19a9a?w=900&q=80',
      'https://images.unsplash.com/photo-1760072513376-67a46aab0fd1?w=900&q=80',
    ],
    cancellationPolicy: 'MODERATE',
    instantBook:        true,
    minStayNights:      2,
    damageDeposit:      200,
    avgRating:          4.5,
    reviewCount:        19,
    isFeatured:         false,
  },
  {
    id:           stableId('listing-tema-compound'),
    hostId:       HOST_AKOSUA,
    title:        'Entire Compound House, Tema Community 25',
    description:  'A large gated compound house in Tema Community 25, ideal for extended families or corporate housing. Features 6 self-contained rooms, borehole water, and a dedicated generator. Secure estate with 24-hour security.',
    propertyType:  'Entire compound',
    region:        'Greater Accra',
    city:          'Tema',
    neighbourhood: 'Community 25',
    lat:           5.6698, lng: 0.0134,
    bedrooms: 6, bathrooms: 4, maxGuests: 15,
    rentalModes:  ['PERMANENT'],
    priceMonthly: 1400, priceAnnual: 16000,
    advanceMonthsRequired: 6,
    amenities:    ['Generator/Inverter', 'Water Storage Tank', 'Parking', 'Boys Quarters', 'Borehole Water', 'CCTV', 'Security Guard'],
    rules:        ['No subletting', 'No business operations', 'Tenants responsible for utility bills'],
    photos: [
      'https://images.unsplash.com/photo-1586228046763-cd367fc926bf?w=900&q=80',
      'https://images.unsplash.com/photo-1745794621090-d856c53b0cc2?w=900&q=80',
    ],
    cancellationPolicy: 'STRICT',
    instantBook:        false,
    minStayNights:      365,
    damageDeposit:      600,
    avgRating:          4.4,
    reviewCount:        6,
    isFeatured:         false,
  },
]

// ── Synthetic verification-doc mockups ──────────────────────────────────────
// Plain generated SVGs, not photos of anyone or anything real — clearly
// watermarked "SAMPLE" so nobody could mistake one for an actual ID scan.
// Real submissions (POST /api/verifications) store an uploaded photo as a
// private Storage *path*, not a URL (see uploadDoc() there), and the admin
// review UI signs a short-lived URL from that path on read (GET
// /api/admin/verifications) — these have to go through that same upload +
// path convention to actually render, not just be a plausible-looking URL.

function ghanaCardSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540">
    <rect width="856" height="540" rx="24" fill="#FAF7F2"/>
    <rect x="0" y="0" width="856" height="16" fill="#CE1126"/>
    <rect x="0" y="16" width="856" height="16" fill="#FCD116"/>
    <rect x="0" y="32" width="856" height="16" fill="#006B3F"/>
    <rect x="6" y="54" width="844" height="480" rx="18" fill="none" stroke="#C9932E" stroke-width="3"/>
    <text x="428" y="100" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#1F1B16">REPUBLIC OF GHANA</text>
    <text x="428" y="128" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" letter-spacing="3" fill="#6B645C">NATIONAL IDENTIFICATION CARD (SAMPLE)</text>
    <rect x="60" y="160" width="170" height="210" rx="8" fill="#E8E2D9" stroke="#C9BBA8" stroke-width="2"/>
    <circle cx="145" cy="228" r="42" fill="#C9BBA8"/>
    <path d="M 85 350 Q 145 285 205 350 Z" fill="#C9BBA8"/>
    <text x="280" y="185" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Surname</text>
    <text x="280" y="208" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">DEMO</text>
    <text x="280" y="243" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Names</text>
    <text x="280" y="266" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">SAMPLE DATA</text>
    <text x="280" y="301" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Personal ID Number</text>
    <text x="280" y="324" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">GHA-000000000-0</text>
    <text x="280" y="359" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Date of Birth</text>
    <text x="280" y="382" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">01 JAN 1990</text>
    <g transform="rotate(-18 428 280)" opacity="0.14">
      <text x="428" y="295" text-anchor="middle" font-family="Arial, sans-serif" font-size="80" font-weight="900" fill="#CE1126">SAMPLE</text>
    </g>
    <text x="428" y="512" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#9C9589">Demo data generated for FieGH testing — not a real identity document</text>
  </svg>`
}

function voterIdSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540">
    <rect width="856" height="540" rx="24" fill="#FAF7F2"/>
    <rect x="0" y="0" width="856" height="16" fill="#CE1126"/>
    <rect x="0" y="16" width="856" height="16" fill="#FCD116"/>
    <rect x="0" y="32" width="856" height="16" fill="#006B3F"/>
    <rect x="6" y="54" width="844" height="480" rx="18" fill="none" stroke="#1F1B16" stroke-width="3"/>
    <text x="428" y="100" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#1F1B16">ELECTORAL COMMISSION OF GHANA</text>
    <text x="428" y="128" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" letter-spacing="3" fill="#6B645C">VOTER IDENTIFICATION CARD (SAMPLE)</text>
    <rect x="60" y="160" width="170" height="210" rx="8" fill="#E8E2D9" stroke="#C9BBA8" stroke-width="2"/>
    <circle cx="145" cy="228" r="42" fill="#C9BBA8"/>
    <path d="M 85 350 Q 145 285 205 350 Z" fill="#C9BBA8"/>
    <text x="280" y="185" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Full Name</text>
    <text x="280" y="208" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">SAMPLE DEMO VOTER</text>
    <text x="280" y="243" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Voter ID Number</text>
    <text x="280" y="266" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">0000000000</text>
    <text x="280" y="301" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Polling Station Code</text>
    <text x="280" y="324" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">A00 / 000 / 0000</text>
    <text x="280" y="359" font-family="Arial, sans-serif" font-size="14" fill="#9C9589">Date of Registration</text>
    <text x="280" y="382" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1F1B16">01 JAN 2020</text>
    <g transform="rotate(-18 428 280)" opacity="0.14">
      <text x="428" y="295" text-anchor="middle" font-family="Arial, sans-serif" font-size="80" font-weight="900" fill="#006B3F">SAMPLE</text>
    </g>
    <text x="428" y="512" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#9C9589">Demo data generated for FieGH testing — not a real identity document</text>
  </svg>`
}

function passportSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="820" viewBox="0 0 600 820">
    <rect width="600" height="820" fill="#FAF7F2"/>
    <rect x="0" y="0" width="600" height="140" fill="#4A0E1F"/>
    <circle cx="300" cy="60" r="34" fill="none" stroke="#D4AF37" stroke-width="3"/>
    <text x="300" y="68" text-anchor="middle" font-family="Georgia, serif" font-size="22" font-weight="700" fill="#D4AF37">GH</text>
    <text x="300" y="112" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="700" fill="#FAF7F2" letter-spacing="4">PASSPORT</text>
    <text x="300" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#D4AF37" letter-spacing="2">REPUBLIC OF GHANA — SAMPLE</text>
    <rect x="40" y="180" width="160" height="200" rx="6" fill="#E8E2D9" stroke="#C9BBA8" stroke-width="2"/>
    <circle cx="120" cy="245" r="40" fill="#C9BBA8"/>
    <path d="M 65 360 Q 120 300 175 360 Z" fill="#C9BBA8"/>
    <text x="220" y="205" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Type / Code</text>
    <text x="220" y="226" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">P / GHA</text>
    <text x="220" y="260" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Passport No.</text>
    <text x="220" y="281" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">G0000000</text>
    <text x="220" y="315" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Surname / Given Names</text>
    <text x="220" y="336" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">DEMO / SAMPLE</text>
    <text x="40" y="410" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Nationality</text>
    <text x="40" y="431" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">GHANAIAN</text>
    <text x="220" y="410" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Date of Birth</text>
    <text x="220" y="431" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">01 JAN 1990</text>
    <text x="40" y="465" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Date of Issue</text>
    <text x="40" y="486" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">01 JAN 2020</text>
    <text x="220" y="465" font-family="Arial, sans-serif" font-size="13" fill="#9C9589">Date of Expiry</text>
    <text x="220" y="486" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#1F1B16">01 JAN 2030</text>
    <g transform="rotate(-18 300 550)" opacity="0.14">
      <text x="300" y="565" text-anchor="middle" font-family="Arial, sans-serif" font-size="70" font-weight="900" fill="#4A0E1F">SAMPLE</text>
    </g>
    <text x="300" y="780" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#9C9589">Demo data generated for FieGH testing — not a real identity document</text>
  </svg>`
}

// Uploads each mockup to the same private bucket + path convention real
// submissions use (`${userId}/id-photo.<ext>`), so idPhotoUrl below is a
// genuine Storage path the admin review route can sign a URL from — not an
// external URL, which createSignedUrl() would just silently fail on.
//
// Rasterized to PNG rather than uploaded as SVG directly — the bucket
// enforces the same image/jpeg|png|webp allow-list POST /api/verifications
// validates against (confirmed by a real 415 from Storage when this tried
// to upload image/svg+xml), so a hand-authored vector mockup still needs
// converting before it's a file the bucket will actually accept.
async function uploadVerificationDocs() {
  const docs = [
    { userId: GUEST_EFUA,  svg: ghanaCardSvg() },
    { userId: GUEST_KOJO,  svg: ghanaCardSvg() },
    { userId: HOST_NANA,   svg: passportSvg() },
    { userId: GUEST_KOFI,  svg: voterIdSvg() },
  ]
  for (const { userId, svg } of docs) {
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const { error } = await supabaseAdmin.storage
      .from(VERIFICATION_DOCS_BUCKET)
      .upload(`${userId}/id-photo.png`, png, { contentType: 'image/png', upsert: true })
    if (error) throw error
  }
  console.log(`   ✓ ${docs.length} verification doc mockups uploaded`)
}

async function upsertUser(user, passwordHash) {
  const data = {
    name:         user.name,
    email:        user.email,
    phone:        user.phone,
    role:         user.role,
    profilePhoto: user.profilePhoto ?? null,
    isVerified:   user.isVerified ?? false,
    isSuperhost:  user.isSuperhost ?? false,
    trustScore:   user.trustScore ?? 0,
    businessName: user.businessName ?? null,
    passwordHash,
  }
  await db.user.upsert({
    where:  { id: user.id },
    update: data,
    create: { id: user.id, ...data },
  })
}

async function seedPanelUsers(passwordHash) {
  console.log('🛡  Seeding admins + extra users for panel testing…')

  for (const admin of ADMINS) {
    await upsertUser(admin, passwordHash)
  }
  console.log(`   ✓ ${ADMINS.length} admins`)

  for (const user of EXTRA_USERS) {
    await upsertUser(user, passwordHash)
  }
  console.log(`   ✓ ${EXTRA_USERS.length} extra guests/hosts`)

  // Demo guest + hosts get real login passwords too
  await upsertUser({
    id: GUEST_KOFI,
    name: 'Kofi Asante',
    email: 'kofi@fiegh.demo',
    phone: '+233245550001',
    role: 'GUEST',
    trustScore: 72,
    isVerified: false,
  }, passwordHash)

  for (const host of HOSTS) {
    await upsertUser(host, passwordHash)
  }
  console.log(`   ✓ ${HOSTS.length} listing hosts + demo guest`)

  // Pending / mixed verifications so Verifications tab has data
  await uploadVerificationDocs()

  const verifications = [
    {
      id:         stableId('verif-efua'),
      userId:     GUEST_EFUA,
      idType:     'GHANA_CARD',
      idPhotoUrl: `${GUEST_EFUA}/id-photo.png`,
      status:     'PENDING',
    },
    {
      id:         stableId('verif-nana'),
      userId:     HOST_NANA,
      idType:     'PASSPORT',
      idPhotoUrl: `${HOST_NANA}/id-photo.png`,
      status:     'PENDING',
    },
    {
      id:         stableId('verif-kofi'),
      userId:     GUEST_KOFI,
      idType:     'VOTER_ID',
      idPhotoUrl: `${GUEST_KOFI}/id-photo.png`,
      status:     'PENDING',
    },
    {
      id:         stableId('verif-kojo'),
      userId:     GUEST_KOJO,
      idType:     'GHANA_CARD',
      idPhotoUrl: `${GUEST_KOJO}/id-photo.png`,
      status:     'APPROVED',
    },
  ]

  for (const v of verifications) {
    await db.verification.upsert({
      where:  { userId: v.userId },
      update: { idType: v.idType, idPhotoUrl: v.idPhotoUrl, status: v.status },
      create: v,
    })
  }
  console.log(`   ✓ ${verifications.length} verification rows`)

  // Ensure exchange rate exists for Settings / Overview
  const rateCount = await db.exchangeRate.count()
  if (rateCount === 0) {
    await db.exchangeRate.create({
      data: { usdToGhs: 15.5, updatedBy: ADMIN_AMA },
    })
    console.log('   ✓ default exchange rate (15.5)')
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  if (force) {
    // Scoped to id: startsWith('seed_') only — see the file header for why
    // that's the marker, not host/user email. BlockedDate rows cascade
    // automatically (onDelete: Cascade in schema), so no separate call is
    // needed for those.
    console.log("\n🗑  --force: pruning seed-owned listings/verifications/users (id starts with 'seed_')…")
    await db.verification.deleteMany({ where: { userId: { startsWith: 'seed_' } } })
    await db.listing.deleteMany({ where: { id: { startsWith: 'seed_' } } })
    await db.user.deleteMany({ where: { id: { startsWith: 'seed_' } } })
  }

  // Always upserts — safe to run any time, including against a DB that
  // already has these rows (the normal case). Only ever creates/updates
  // rows whose id is one of this file's own stableId(...) values, so it
  // can never touch a real user/listing (which have ordinary cuid ids).
  await seedPanelUsers(passwordHash)

  // ── Seed listings ──────────────────────────────────────────────────────
  console.log('🏠 Seeding listings…')
  for (const l of LISTINGS) {
    // Single field list shared by create and update, so the two can never
    // drift apart again the way they did before (update only synced 3 of
    // ~25 fields, silently dropping edits like photo changes).
    const fields = {
      hostId:                l.hostId,
      title:                 l.title,
      description:           l.description,
      propertyType:          l.propertyType,
      region:                l.region,
      city:                  l.city,
      neighbourhood:         l.neighbourhood ?? null,
      lat:                   l.lat ?? null,
      lng:                   l.lng ?? null,
      bedrooms:              l.bedrooms,
      bathrooms:             l.bathrooms,
      maxGuests:             l.maxGuests,
      rentalModes:           JSON.stringify(l.rentalModes),
      priceNightly:          l.priceNightly  ?? null,
      priceMonthly:          l.priceMonthly  ?? null,
      priceAnnual:           l.priceAnnual   ?? null,
      advanceMonthsRequired: l.advanceMonthsRequired ?? null,
      amenities:             JSON.stringify(l.amenities),
      rules:                 JSON.stringify(l.rules),
      photos:                JSON.stringify(l.photos),
      cancellationPolicy:    l.cancellationPolicy,
      instantBook:           l.instantBook,
      minStayNights:         l.minStayNights,
      damageDeposit:         l.damageDeposit ?? null,
      avgRating:             l.avgRating,
      reviewCount:           l.reviewCount,
      isActive:              true,
      isFeatured:            l.isFeatured,
    }
    await db.listing.upsert({
      where:  { id: l.id },
      update: fields,
      create: { id: l.id, ...fields },
    })
    console.log(`   ✓ ${l.title}`)
  }

  console.log('\n✅ Seed complete!')
  console.log(`   ${HOSTS.length} hosts  |  ${LISTINGS.length} listings`)
  console.log('\n   Listing IDs (stable across re-seeds):')
  for (const l of LISTINGS) console.log(`   ${l.id}  →  ${l.title}`)
  printLoginHints()
}

function printLoginHints() {
  console.log('\n🔑 Demo logins (password for all: Demo1234!)')
  console.log('   ADMIN  admin@fiegh.demo   →  /admin')
  console.log('   ADMIN  admin2@fiegh.demo  →  /admin')
  console.log('   HOST   abena@fiegh.demo')
  console.log('   GUEST  kofi@fiegh.demo')
  console.log('   GUEST  efua@fiegh.demo   (pending verification)')
  console.log('   HOST   nana@fiegh.demo   (pending verification)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
