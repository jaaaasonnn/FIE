/**
 * prisma/seed.mjs
 *
 * Inserts the 8 canonical demo listings (3 hosts) into the dev SQLite DB.
 *
 * Run with:
 *   npm run db:seed
 *
 * Safe to re-run — skips if listings already exist unless you pass --force:
 *   npm run db:seed -- --force
 */

import { PrismaClient } from '@prisma/client'
import { createHash }   from 'node:crypto'

const db    = new PrismaClient()
const force = process.argv.includes('--force')

// ── Deterministic CUID-like IDs so links stay stable across re-seeds ────────
// We derive stable IDs from a short key so the URLs in the app never break.
function stableId(key) {
  return 'seed_' + createHash('md5').update(key).digest('hex').slice(0, 20)
}

const HOST_ABENA  = stableId('host-abena-mensah')
const HOST_KWESI  = stableId('host-kwesi-boateng')
const HOST_AKOSUA = stableId('host-akosua-darko')

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
    profilePhoto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80',
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
    profilePhoto: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80',
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
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=900&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=900&q=80',
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
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=900&q=80',
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
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=900&q=80',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80',
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
      'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=900&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80',
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
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=900&q=80',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&q=80',
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
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=900&q=80',
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
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80',
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
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80',
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=900&q=80',
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

async function main() {
  // ── Guard ──────────────────────────────────────────────────────────────
  if (!force) {
    const count = await db.listing.count()
    if (count > 0) {
      console.log(`⏭  ${count} listing(s) already in DB — skipping seed.`)
      console.log('   Pass --force to wipe and re-seed: npm run db:seed -- --force')
      return
    }
  } else {
    console.log('🗑  --force: wiping existing listings, blocked dates, and seed users…')
    await db.blockedDate.deleteMany()
    await db.listing.deleteMany()
    await db.user.deleteMany({ where: { email: { endsWith: '@fiegh.demo' } } })
  }

  // ── Seed hosts ─────────────────────────────────────────────────────────
  console.log('👤 Seeding hosts…')
  for (const host of HOSTS) {
    await db.user.upsert({
      where:  { id: host.id },
      update: {},
      create: {
        id:           host.id,
        name:         host.name,
        email:        host.email,
        phone:        host.phone,
        role:         host.role,
        profilePhoto: host.profilePhoto,
        isVerified:   host.isVerified,
        isSuperhost:  host.isSuperhost,
        trustScore:   host.trustScore,
        passwordHash: '$2a$10$demohashdemohashdemohasXXXXXXXX', // placeholder, not a real hash
      },
    })
  }
  console.log(`   ✓ ${HOSTS.length} hosts upserted`)

  // ── Seed listings ──────────────────────────────────────────────────────
  console.log('🏠 Seeding listings…')
  for (const l of LISTINGS) {
    await db.listing.upsert({
      where:  { id: l.id },
      update: {
        avgRating:   l.avgRating,
        reviewCount: l.reviewCount,
        isFeatured:  l.isFeatured,
      },
      create: {
        id:                   l.id,
        hostId:               l.hostId,
        title:                l.title,
        description:          l.description,
        propertyType:         l.propertyType,
        region:               l.region,
        city:                 l.city,
        neighbourhood:        l.neighbourhood ?? null,
        lat:                  l.lat ?? null,
        lng:                  l.lng ?? null,
        bedrooms:             l.bedrooms,
        bathrooms:            l.bathrooms,
        maxGuests:            l.maxGuests,
        rentalModes:          JSON.stringify(l.rentalModes),
        priceNightly:         l.priceNightly  ?? null,
        priceMonthly:         l.priceMonthly  ?? null,
        priceAnnual:          l.priceAnnual   ?? null,
        advanceMonthsRequired: l.advanceMonthsRequired ?? null,
        amenities:            JSON.stringify(l.amenities),
        rules:                JSON.stringify(l.rules),
        photos:               JSON.stringify(l.photos),
        cancellationPolicy:   l.cancellationPolicy,
        instantBook:          l.instantBook,
        minStayNights:        l.minStayNights,
        damageDeposit:        l.damageDeposit ?? null,
        avgRating:            l.avgRating,
        reviewCount:          l.reviewCount,
        isActive:             true,
        isFeatured:           l.isFeatured,
      },
    })
    console.log(`   ✓ ${l.title}`)
  }

  console.log('\n✅ Seed complete!')
  console.log(`   ${HOSTS.length} hosts  |  ${LISTINGS.length} listings`)
  console.log('\n   Listing IDs (stable across re-seeds):')
  for (const l of LISTINGS) console.log(`   ${l.id}  →  ${l.title}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
