-- Run once against any new database. Already applied to production Supabase.
-- Enable Row Level Security on all public-schema tables flagged by
-- Supabase's Security Advisor ("RLS Disabled in Public").
--
-- Safe to run: the app's Prisma connection uses the `postgres` role,
-- which has BYPASSRLS set (verified directly against pg_roles) — this
-- will not change any app behavior. No policies are added because
-- nothing in the codebase queries these tables through a role that is
-- actually subject to RLS (no anon-key / client-side Supabase usage
-- exists — verified against the full source tree).
--
-- Generated for the FieGH Supabase project. Paste into SQL Editor and
-- run once.

ALTER TABLE public."BlockedDate"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Booking"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Dispute"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DisputeEvent"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DisputeEvidence"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ExchangeRate"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Instalment"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Listing"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Message"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageLog"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Payment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Payout"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Refund"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RentalApplication"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Review"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SiteSetting"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Verification"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Wishlist"           ENABLE ROW LEVEL SECURITY;
