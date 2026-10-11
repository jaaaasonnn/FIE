// Shared pieces for the security tests: one in-memory database, one signed-in
// person, and short ways to call a route.

import type { Row, Tables } from '@/lib/testing/fakeDb'

export type State = { tables: Tables; user: Row | null }

export const NOW = new Date('2027-03-01T10:00:00Z')

/** Empties every table, keeping the object the fake database was built on. */
export function reset(state: State) {
  for (const key of Object.keys(state.tables)) delete state.tables[key]
  state.user = null
}

export const json = (method: string, body?: unknown, headers: Record<string, string> = {}, url = 'http://localhost/api/x') =>
  new Request(url, { method, headers: { 'content-type': 'application/json', origin: 'http://localhost', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })

export const params = (id: string) => ({ params: Promise.resolve({ id }) })

export function person(state: State, id: string, role: 'GUEST' | 'HOST' | 'ADMIN' = 'GUEST', over: Row = {}): Row {
  const row = {
    id, role, name: `Person ${id}`, email: `${id}@example.test`, phone: null, passwordHash: null,
    isVerified: false, isSuperhost: false, trustScore: 0, emailVerifiedAt: NOW, profilePhoto: null, optionalEmails: true, ...over,
  }
  ;(state.tables.user ??= []).push(row)
  return row
}

/** Signs a person in for the routes under test. */
export function as(state: State, id: string | null) {
  state.user = id ? (state.tables.user ?? []).find((u) => u.id === id) ?? null : null
}

export function home(state: State, id: string, hostId: string, over: Row = {}): Row {
  const row = {
    id, hostId, title: `Home ${id}`, description: 'A quiet flat.', propertyType: 'Apartment', region: 'Greater Accra', city: 'Accra',
    neighbourhood: 'Osu', digitalAddress: null, lat: null, lng: null, bedrooms: 2, bathrooms: 1, maxGuests: 2,
    amenities: '[]', rentalModes: '["SHORT_STAY"]', rules: '[]', photos: '[]', priceNightly: 100, priceMonthly: null, priceAnnual: null,
    advanceMonthsRequired: null, cancellationPolicy: 'MODERATE', instantBook: true, minStayNights: 1, isActive: true, moderationHold: false,
    isFeatured: false, avgRating: 0, reviewCount: 0, welcomeMessage: null, damageDeposit: null, createdAt: NOW, updatedAt: NOW, ...over,
  }
  ;(state.tables.listing ??= []).push(row)
  return row
}

export function stay(state: State, id: string, listingId: string, guestId: string, hostId: string, over: Row = {}): Row {
  const row = {
    id, listingId, guestId, hostId, rentalMode: 'SHORT_STAY', checkIn: new Date('2027-03-09T12:00:00Z'), checkOut: new Date('2027-03-12T12:00:00Z'),
    nightsOrMonths: 3, pricePerUnit: 100, subtotal: 300, serviceFee: 0, damageDeposit: 0, totalPrice: 300, status: 'CONFIRMED', paymentStatus: 'PAID',
    payBy: null, cancellationPolicy: 'MODERATE', specialRequests: null, createdAt: NOW, ...over,
  }
  ;(state.tables.booking ??= []).push(row)
  return row
}
