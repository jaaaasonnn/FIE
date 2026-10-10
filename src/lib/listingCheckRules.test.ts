import { describe, expect, it } from 'vitest'
import {
  ADDRESS_FIELDS, CHECK_BADGE, CHECK_FAQ, CHECK_FILTER_LABEL, CHECK_ITEMS, CHECK_ITEM_KEYS, CHECK_METHODS, CHECK_REMINDER_DAYS,
  CHECK_TERMS, CHECK_VALID_MONTHS, DETAIL_FIELDS, DIGITAL_ADDRESS_PUBLIC, EDIT_REMOVES_CHECK, HOST_ID_BADGE, ID_BADGE, MIN_CHECK_NOTE,
  checkExpiry, checkExplanation, editRevokes, expiresSoon, isLive, liveCheck, liveCheckWhere, markRefusal, photoList, publicCheck,
  removalReasonText,
} from '@/lib/listingCheckRules'

// Pure rules and wording. Nothing here depends on the machine's time zone.

const at = (iso: string) => new Date(iso)
const check = (over: Record<string, unknown> = {}) => ({ checkedAt: at('2027-03-12T10:00:00Z'), expiresAt: at('2028-03-12T10:00:00Z'), revokedAt: null, ...over })

describe('when a listing has the badge', () => {
  it('lasts twelve months from the moment of the check', () => {
    expect(CHECK_VALID_MONTHS).toBe(12)
    expect(checkExpiry(at('2027-03-12T10:15:30.250Z')).toISOString()).toBe('2028-03-12T10:15:30.250Z')
    expect(checkExpiry(at('2027-12-31T23:59:59Z')).toISOString()).toBe('2028-12-31T23:59:59.000Z')
    // 29 February has no anniversary the next year: the last day of February
    expect(checkExpiry(at('2028-02-29T08:00:00Z')).toISOString()).toBe('2029-02-28T08:00:00.000Z')
  })

  it('stands until the expiry moment and is gone at it, with no job involved', () => {
    const c = check()
    expect(isLive(c, at('2027-03-12T10:00:00Z'))).toBe(true)
    expect(isLive(c, at('2028-03-12T09:59:59.999Z'))).toBe(true)
    expect(isLive(c, at('2028-03-12T10:00:00.000Z'))).toBe(false)
    expect(isLive(c, at('2030-01-01T00:00:00Z'))).toBe(false)
  })

  it('is gone as soon as it is revoked, however long it had left', () => {
    expect(isLive(check({ revokedAt: at('2027-03-13T00:00:00Z') }), at('2027-03-14T00:00:00Z'))).toBe(false)
  })

  it('comes from the newest check that stands', () => {
    const old = check({ checkedAt: at('2026-01-01T00:00:00Z'), expiresAt: at('2027-01-01T00:00:00Z') })
    const revoked = check({ checkedAt: at('2027-06-01T00:00:00Z'), expiresAt: at('2028-06-01T00:00:00Z'), revokedAt: at('2027-06-02T00:00:00Z') })
    const standing = check()
    const now = at('2027-07-01T00:00:00Z')
    expect(liveCheck([old, revoked, standing], now)).toBe(standing)
    expect(liveCheck([old, revoked], now)).toBeNull()
    expect(liveCheck([], now)).toBeNull()
    expect(liveCheck(null, now)).toBeNull()
    expect(liveCheck(undefined, now)).toBeNull()
  })

  it('is the same rule as the database filter', () => {
    const now = at('2027-07-01T00:00:00Z')
    expect(liveCheckWhere(now)).toEqual({ revokedAt: null, expiresAt: { gt: now } })
  })

  it('counts as running out soon in its last 30 days', () => {
    expect(CHECK_REMINDER_DAYS).toBe(30)
    const c = check()
    expect(expiresSoon(c, at('2028-02-10T09:59:00Z'))).toBe(false)
    expect(expiresSoon(c, at('2028-02-11T10:00:00Z'))).toBe(true)
    expect(expiresSoon(c, at('2028-03-12T09:00:00Z'))).toBe(true)
    expect(expiresSoon(c, at('2028-03-12T10:00:00Z'))).toBe(false)   // expired, not "soon"
    expect(expiresSoon(check({ revokedAt: at('2028-02-20T00:00:00Z') }), at('2028-03-01T00:00:00Z'))).toBe(false)
  })

  it('shows the public only the two dates', () => {
    const row = { ...check(), id: 'c1', note: 'private', checkedById: 'admin_1', digitalAddress: 'GA-183-8164', method: 'VISIT' }
    expect(publicCheck(row)).toEqual({ checkedAt: '2027-03-12T10:00:00.000Z', expiresAt: '2028-03-12T10:00:00.000Z' })
    expect(publicCheck(null)).toBeNull()
  })
})

describe('what an admin must record', () => {
  const listing = { digitalAddress: 'GA-183-8164', photos: '["a.jpg","b.jpg"]', isActive: true, moderationHold: false }
  const input = { method: 'VIDEO_CALL', checks: [...CHECK_ITEM_KEYS], note: 'Video call with the host on 12 March, walked through every room.' }

  it('is three things confirmed, how the home was seen, and a note', () => {
    expect(CHECK_ITEM_KEYS).toEqual(['ADDRESS_MATCHES', 'PHOTOS_MATCH', 'HOST_HAD_ACCESS'])
    expect(Object.keys(CHECK_METHODS)).toEqual(['VIDEO_CALL', 'VISIT'])
    expect(MIN_CHECK_NOTE).toBe(20)
    expect(markRefusal(listing, input)).toBeNull()
    expect(markRefusal(listing, { ...input, method: 'VISIT' })).toBeNull()
  })

  it('never asks the admin to confirm who owns the home', () => {
    expect(JSON.stringify(CHECK_ITEMS)).not.toMatch(/own|title deed|landlord|guarantee/i)
  })

  it('is refused with any item missing', () => {
    for (const missing of CHECK_ITEM_KEYS) {
      expect(markRefusal(listing, { ...input, checks: CHECK_ITEM_KEYS.filter((k) => k !== missing) }), missing).toMatch(/Every item/)
    }
    for (const bad of [[], undefined, 'ADDRESS_MATCHES,PHOTOS_MATCH,HOST_HAD_ACCESS', true, ['OWNERSHIP']]) {
      expect(markRefusal(listing, { ...input, checks: bad })).toMatch(/Every item/)
    }
  })

  it('is refused without a method, or with a made-up one', () => {
    for (const bad of [undefined, '', 'PHONE_CALL', 'toString', 5]) expect(markRefusal(listing, { ...input, method: bad })).toMatch(/video call or a visit/)
  })

  it('is refused without a real note', () => {
    for (const bad of [undefined, '', 'ok', '   too short   ', 'x'.repeat(19), 42]) expect(markRefusal(listing, { ...input, note: bad })).toMatch(/at least 20 characters/)
    expect(markRefusal(listing, { ...input, note: 'x'.repeat(1001) })).toMatch(/at most 1000/)
  })

  it('is refused for a listing with no photos, whatever is ticked', () => {
    for (const photos of ['[]', '', 'not json', '{}', '[""]', '[null]']) expect(markRefusal({ ...listing, photos }, input), photos).toMatch(/no photos/)
    expect(photoList('["a.jpg", "", null, 5, "b.jpg"]')).toEqual(['a.jpg', 'b.jpg'])
  })

  it('is refused for a listing with no digital address', () => {
    for (const digitalAddress of [null, '']) expect(markRefusal({ ...listing, digitalAddress }, input)).toMatch(/no digital address/)
  })

  it('is refused for a listing that is on hold or switched off', () => {
    expect(markRefusal({ ...listing, moderationHold: true }, input)).toMatch(/on hold/)
    expect(markRefusal({ ...listing, isActive: false }, input)).toMatch(/switched off/)
  })
})

describe('which edits take the badge away', () => {
  const before = {
    digitalAddress: 'GA-183-8164', region: 'Greater Accra', city: 'Accra', neighbourhood: 'East Legon', lat: 5.63, lng: -0.16,
    propertyType: 'Apartment', bedrooms: 2, title: 'A home', description: 'Nice', priceNightly: 100, photos: '["a.jpg"]',
  }

  it('are a change to where the home is said to be', () => {
    expect(ADDRESS_FIELDS).toEqual(['digitalAddress', 'region', 'city', 'neighbourhood', 'lat', 'lng'])
    const changes: Record<string, unknown> = { digitalAddress: 'GA-183-8165', region: 'Ashanti', city: 'Tema', neighbourhood: 'Osu', lat: 5.64, lng: -0.17 }
    for (const [field, value] of Object.entries(changes)) expect(editRevokes(before, { [field]: value }), field).toBe('ADDRESS_CHANGED')
    // Removing the digital address, or the neighbourhood, is a change too
    expect(editRevokes(before, { digitalAddress: null })).toBe('ADDRESS_CHANGED')
    expect(editRevokes(before, { neighbourhood: '' })).toBe('ADDRESS_CHANGED')
  })

  it('are a change to the property type or the number of bedrooms', () => {
    expect(DETAIL_FIELDS).toEqual(['propertyType', 'bedrooms'])
    expect(editRevokes(before, { propertyType: 'Villa' })).toBe('DETAILS_CHANGED')
    expect(editRevokes(before, { bedrooms: 3 })).toBe('DETAILS_CHANGED')
    expect(editRevokes(before, { bedrooms: '4' })).toBe('DETAILS_CHANGED')
  })

  it('are not a save that sends the same values back, as the edit form always does', () => {
    expect(editRevokes(before, { ...before })).toBeNull()
    expect(editRevokes(before, { bedrooms: '2', city: ' Accra ', lat: '5.63' })).toBeNull()
    expect(editRevokes({ ...before, neighbourhood: null, lat: null }, { neighbourhood: '', lat: undefined })).toBeNull()
  })

  it('are not anything else about the listing', () => {
    expect(editRevokes(before, {
      title: 'A lovely home', description: 'Changed', priceNightly: 120, priceMonthly: 900, amenities: '["WiFi"]', rules: '[]',
      cancellationPolicy: 'STRICT', instantBook: true, minStayNights: 3, damageDeposit: 50, welcomeMessage: 'Hi', isActive: false,
      bathrooms: 3, maxGuests: 6, rentalModes: '["SHORT_STAY"]', advanceMonthsRequired: 2,
    })).toBeNull()
    expect(editRevokes(before, {})).toBeNull()
  })

  it('tells the host why, in plain words, and never passes on more than the reason given', () => {
    expect(removalReasonText('ADDRESS_CHANGED')).toBe('the address was changed')
    expect(removalReasonText('DETAILS_CHANGED')).toBe('the property type or the number of bedrooms was changed')
    expect(removalReasonText('PHOTOS_CHANGED')).toBe('the photos were changed')
    expect(removalReasonText('LISTING_HELD')).toBe('the listing was put on hold')
    expect(removalReasonText('ADMIN', 'The photos are of another flat')).toBe('removed by our team: The photos are of another flat')
    expect(removalReasonText('ADMIN', null)).toBe('removed by our team')
  })
})

describe('the wording', () => {
  const explanation = checkExplanation(check())
  const everything = [CHECK_BADGE, CHECK_FILTER_LABEL, explanation, DIGITAL_ADDRESS_PUBLIC, EDIT_REMOVES_CHECK, CHECK_TERMS, ...CHECK_FAQ.flatMap((f) => [f.q, f.a])]

  it('is exactly what was approved', () => {
    expect(CHECK_BADGE).toBe('Address and photos checked')
    expect(CHECK_FILTER_LABEL).toBe('Address and photos checked by FieGH')
    expect(explanation).toBe("FieGH checked this listing's address and photos on 12 March 2027. This is not proof of who owns the home and it is not a guarantee. We check again by 12 March 2028.")
    expect(DIGITAL_ADDRESS_PUBLIC).toBe('On file with FieGH. You will see it once your booking is confirmed.')
    expect(HOST_ID_BADGE).toBe('Host ID checked')
    expect(ID_BADGE).toBe('ID checked')
    expect(CHECK_FAQ.map((f) => f.q)).toEqual(['What does "Address and photos checked" mean?', 'How long does the check last?'])
    expect(CHECK_FAQ[0].a).toContain('It does not mean FieGH has confirmed who owns the home, and it is not a guarantee about the home or the host.')
    expect(CHECK_FAQ[1].a).toBe('Twelve months. It is also removed straight away if the host changes the address or the photos, until we have checked again. A listing without it has not been checked yet; that does not mean anything is wrong with it.')
    expect(CHECK_TERMS).toBe('Some listings show "Address and photos checked". This records that FieGH checked the listing\'s digital address and photos on the date shown. It is not verification of ownership or of the host\'s right to let the home, and it is not a warranty or guarantee of the home\'s condition, safety or availability. FieGH may remove it at any time. Clause 9 (Limitation of Liability) applies in full.')
  })

  it('never says "verified", and says "verification" only to deny it', () => {
    for (const text of everything) expect(text).not.toMatch(/verified|verify\b/i)
    const withVerification = everything.filter((t) => /verification/i.test(t))
    expect(withVerification).toEqual([CHECK_TERMS])
    expect(CHECK_TERMS).toContain('It is not verification of ownership')
  })

  it('mentions ownership and a guarantee only to say it is neither', () => {
    for (const text of everything) {
      for (const sentence of text.split(/(?<=[.?])\s+/)) {
        if (/\bown(s|er|ership)?\b|guarantee|warranty/i.test(sentence)) expect(sentence, sentence).toMatch(/\bnot\b/)
      }
    }
    expect(CHECK_BADGE).not.toMatch(/own|guarantee|safe|trusted|approved|certified/i)
  })

  it('always says what was checked and when', () => {
    expect(explanation).toContain('address and photos')
    expect(explanation).toMatch(/on 12 March 2027/)
    // The same date in every time zone: it is written from UTC, which is Ghana's time
    expect(checkExplanation({ checkedAt: '2027-03-12T23:30:00Z', expiresAt: '2028-03-12T23:30:00Z' })).toContain('on 12 March 2027')
    expect(checkExplanation({ checkedAt: '2027-03-12T00:30:00Z', expiresAt: '2028-03-12T00:30:00Z' })).toContain('on 12 March 2027')
  })
})
