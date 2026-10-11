-- Rules the database keeps that the Prisma schema cannot state. Run once
-- against any new database, after the tables exist. Already applied to
-- production Supabase (2026-10-12).
--
-- A damage deposit is never negative. A negative one would come off what the
-- guest is charged while the host is still paid for the whole stay. The app
-- refuses one in src/lib/listingInput.ts; this is the backstop.

ALTER TABLE public."Listing" ADD CONSTRAINT "Listing_damageDeposit_nonneg"
  CHECK ("damageDeposit" IS NULL OR "damageDeposit" >= 0);

ALTER TABLE public."Booking" ADD CONSTRAINT "Booking_damageDeposit_nonneg"
  CHECK ("damageDeposit" >= 0);

-- One review per side per booking. Stated in schema.prisma as @@unique, so a
-- database made by Prisma already has it; listed here because production got
-- it by hand.
-- CREATE UNIQUE INDEX "Review_bookingId_reviewerId_type_key"
--   ON public."Review"("bookingId", "reviewerId", "type");
