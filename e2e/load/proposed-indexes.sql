-- PROPOSED indexes from the second go (stage B5). SHOWN FOR REVIEW: never run by the tests on any live
-- database. On Supabase they would be run by the owner, with CONCURRENTLY so tables are not locked, and then
-- added to prisma/schema.prisma as @@index so `prisma db push` does not drop them. The e2e stack applies them
-- to the throwaway local test database only, to measure (e2e/load/indexes.mjs), and removes them afterwards.
--
-- Measured (e2e/.reports/stageB/server-timing-cmp-*.json, 30 requests a route, one at a time): with these,
-- p95 falls 40-70% on the routes guests and hosts use most (their bookings, payments, messages, booking a
-- home) and is unchanged on the rest. They do NOT fix the slow admin overview, Verifications tab or payout job.
--
-- Evidence (seeded test database, e2e/.reports/stageB/server-timing-seeded.json): sequential scans during one
-- timing pass read Booking 35.6 M rows (711 scans), Payment 19.1 M (342 scans, never by index), Message 15.9 M
-- (159 scans), Review 5.4 M (318 scans, never by index). Removing the load set took 238 s against 11 s to make
-- it: every deleted booking or user is checked against these columns, which have no index.

-- Foreign keys the app filters or joins on (Prisma does not index relation columns on Postgres by itself)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_guestId_idx"        ON "Booking" ("guestId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_hostId_idx"         ON "Booking" ("hostId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_bookingId_idx"      ON "Payment" ("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_senderId_idx"       ON "Message" ("senderId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_receiverId_idx"     ON "Message" ("receiverId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_bookingId_idx"      ON "Message" ("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_listingId_idx"      ON "Message" ("listingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Review_listingId_idx"       ON "Review" ("listingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Review_revieweeId_idx"      ON "Review" ("revieweeId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Review_reviewerId_idx"      ON "Review" ("reviewerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_hostId_idx"         ON "Listing" ("hostId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payout_hostId_idx"          ON "Payout" ("hostId", "createdAt");
-- NOT proposed: "Payout" ("instalmentId"). Measured on the seeded database it made the payout job and the two
-- slow admin routes 10-20% SLOWER (the "no payout yet" check turns from one hash join into ~19,000 lookups).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_idx"    ON "Notification" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_userId_idx"         ON "Session" ("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Wishlist_listingId_idx"     ON "Wishlist" ("listingId");

-- Search with dates: "no live booking overlaps these dates" is answered today by reading every booking.
-- Live bookings by check-out let it read only stays that end after the requested check-in.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_live_checkOut_idx"  ON "Booking" ("checkOut", "checkIn", "listingId") WHERE status NOT IN ('CANCELLED', 'DECLINED');

-- Payouts due (the payout job, the admin overview and the Verifications tab): paid bookings by check-in, so
-- the job reads paid stays only, newest first. This narrows the scan; it does not stop it from growing with
-- history. That needs a change in the code (see FINDINGS, G12): owner's decision.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_paid_checkIn_idx"   ON "Booking" ("rentalMode", "checkIn") WHERE status IN ('CONFIRMED', 'COMPLETED') AND "paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED');
