export type RentalMode = 'SHORT_STAY' | 'TEMP_STAY' | 'PERMANENT'
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'DISPUTED'
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED' | 'RELEASED'
export type UserRole = 'GUEST' | 'HOST' | 'ADMIN'
export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED'
export type PayoutMethod = 'MOMO' | 'BANK_TRANSFER'
export type MomoNetwork = 'MTN' | 'VODAFONE' | 'AIRTELTIGO'
export type CancellationPolicy = 'FLEXIBLE' | 'MODERATE' | 'STRICT'

export interface ListingSearchParams {
  mode?: RentalMode
  region?: string
  city?: string
  minPrice?: number
  maxPrice?: number
  bedrooms?: number
  propertyType?: string
  amenities?: string[]
  checkIn?: string
  checkOut?: string
  verified?: boolean
  superhost?: boolean
  sort?: 'price_asc' | 'price_desc' | 'top_rated' | 'most_reviewed' | 'newest'
  page?: number
}

export interface BookingCreateInput {
  listingId: string
  rentalMode: RentalMode
  checkIn: Date
  checkOut: Date
  nightsOrMonths: number
  specialRequests?: string
}
