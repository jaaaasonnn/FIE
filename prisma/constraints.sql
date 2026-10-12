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

-- The Supabase roles the public API uses are given nothing on these tables.
-- Row-level security with no policies already kept them out; this takes the
-- grants away too, for the tables that exist and for any the `postgres` role
-- (Prisma) creates later. Nothing in the app uses these roles. Tables made
-- through the Supabase dashboard are owned by `supabase_admin`, which this
-- does not cover: run the first statement again after making one that way.
-- Applied to production Supabase (2026-10-12).

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- Account suspension (src/lib/suspension.ts). In schema.prisma, so a database
-- made by Prisma already has them; listed here because production got them
-- by hand (2026-10-12).
-- ALTER TABLE public."User" ADD COLUMN "suspendedAt" TIMESTAMP(3),
--   ADD COLUMN "suspendedById" TEXT, ADD COLUMN "suspendedReason" TEXT;
