-- Removes every row of the load-test data set (ids starting load_) and anything that points at one,
-- children first. LOCAL TEST DATABASE ONLY, through e2e/load/seed.mjs --remove.
-- Rows the app wrote during a load run on load_ people or homes (sessions, sign-in counts, messages,
-- bookings, payments, notifications, message log) are removed with them.
DELETE FROM "Refund" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "Payout" WHERE id LIKE 'load\_%' OR "hostId" LIKE 'load\_%';
DELETE FROM "Payment" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "Review" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "Message" WHERE "senderId" LIKE 'load\_%' OR "receiverId" LIKE 'load\_%' OR "listingId" LIKE 'load\_%';
DELETE FROM "DisputeEvent" WHERE "disputeId" IN (SELECT d.id FROM "Dispute" d JOIN "Booking" b ON b.id = d."bookingId" WHERE b."listingId" LIKE 'load\_%' OR b."guestId" LIKE 'load\_%');
DELETE FROM "DisputeEvidence" WHERE "disputeId" IN (SELECT d.id FROM "Dispute" d JOIN "Booking" b ON b.id = d."bookingId" WHERE b."listingId" LIKE 'load\_%' OR b."guestId" LIKE 'load\_%');
DELETE FROM "Dispute" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "RentalApplication" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "Instalment" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%');
DELETE FROM "Booking" WHERE "listingId" LIKE 'load\_%' OR "guestId" LIKE 'load\_%';
DELETE FROM "BlockedDate" WHERE "listingId" LIKE 'load\_%';
DELETE FROM "Wishlist" WHERE "userId" LIKE 'load\_%' OR "listingId" LIKE 'load\_%';
DELETE FROM "ListingCheck" WHERE "listingId" LIKE 'load\_%';
DELETE FROM "Listing" WHERE "hostId" LIKE 'load\_%';
DELETE FROM "Notification" WHERE "userId" LIKE 'load\_%';
DELETE FROM "MessageLog" WHERE "userId" LIKE 'load\_%';
DELETE FROM "Session" WHERE "userId" LIKE 'load\_%';
DELETE FROM "AuthToken" WHERE "userId" LIKE 'load\_%';
DELETE FROM "AuthRequest" WHERE "userId" LIKE 'load\_%';
DELETE FROM "Verification" WHERE "userId" LIKE 'load\_%';
DELETE FROM "User" WHERE id LIKE 'load\_%';
