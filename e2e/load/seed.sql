-- The load-test data set for the second go (performance and load). LOCAL TEST DATABASE ONLY:
-- run it through `node e2e/run.mjs exec node e2e/load/seed.mjs`, which refuses any other database.
--
-- 20,000 users (5 admins, 2,000 hosts, 17,995 guests), 5,000 listings, 50,000 bookings with their
-- payments, rent instalments and payouts, 200,000 blocked dates, 100,000 messages, reviews and
-- 30,000 wishlist entries. Every id starts with load_ so it can be removed (unseed.sql).
--
-- Set-based, and the same every time: the "random" numbers are hashes of a row's own key (lr()),
-- not random(), so the rows do not depend on the order Postgres reads them in. Dates are counted
-- from the day it is seeded (:anchor, 12:00 UTC), so "past" and "future" bookings stay that way.
-- Every seeded person's password is Load-pass-2026.
--
-- The rules in e2e/lib/invariants.ts hold for this data: no two live bookings overlap on a listing,
-- totals add up, instalments add up to the rent, every paid booking or instalment has one successful
-- payment, payouts are 90% of the rent and only for hosts whose ID was approved.

CREATE OR REPLACE FUNCTION pg_temp.lr(key text) RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT ('x' || substr(md5(key), 1, 8))::bit(32)::bigint / 4294967296.0 $$;

CREATE TEMP TABLE load_anchor AS SELECT date_trunc('day', now() AT TIME ZONE 'utc') + interval '12 hours' AS t;

-- ── People ──────────────────────────────────────────────────────────────────────────────────────
INSERT INTO "User" (id, name, email, "passwordHash", role, "trustScore", "isVerified", "emailVerifiedAt",
  "payoutMethod", "payoutMomoNetwork", "payoutMomoNumber", "paystackRecipientCode", "payoutMethodVerifiedAt", "createdAt", "updatedAt")
SELECT 'load_u_' || lpad(n::text, 5, '0'),
  'Load ' || CASE WHEN n <= 5 THEN 'Admin' WHEN n <= 2005 THEN 'Host' ELSE 'Guest' END || ' ' || n,
  'load-' || n || '@load.fiegh.test',
  '$2b$12$snnX1Pl2rZBPRuq.uRq.xOMGR6tLl8YSw7xF0/fPQzcfnX9WhITKK',
  CASE WHEN n <= 5 THEN 'ADMIN' WHEN n <= 2005 THEN 'HOST' ELSE 'GUEST' END,
  40 + floor(pg_temp.lr('trust' || n) * 60)::int,
  n BETWEEN 6 AND 2005,
  a.t - interval '1300 days',
  CASE WHEN n BETWEEN 6 AND 2005 THEN 'MOMO' END,
  CASE WHEN n BETWEEN 6 AND 2005 THEN 'MTN' END,
  CASE WHEN n BETWEEN 6 AND 2005 THEN '024' || lpad(n::text, 7, '0') END,
  CASE WHEN n BETWEEN 6 AND 2005 THEN 'load_rcp_' || n END,
  CASE WHEN n BETWEEN 6 AND 2005 THEN a.t - interval '1250 days' END,
  a.t - interval '1300 days' + (n % 300) * interval '1 day', a.t - interval '1300 days'
FROM generate_series(1, 20000) n, load_anchor a;

INSERT INTO "Verification" (id, "userId", "idType", "idPhotoUrl", status, "reviewedById", "createdAt", "updatedAt")
SELECT 'load_v_' || n, 'load_u_' || lpad(n::text, 5, '0'), 'GHANA_CARD', 'load/' || n || '.jpg', 'APPROVED', 'load_u_00001', a.t - interval '1280 days', a.t - interval '1270 days'
FROM generate_series(6, 2005) n, load_anchor a;

-- ── Listings: 4,200 short stays, 600 monthly, 200 long-term ──────────────────────────────────────
CREATE TEMP TABLE load_city (lo float, hi float, region text, city text, hood text, lat float, lng float);
INSERT INTO load_city VALUES
  (0.00, 0.45, 'Greater Accra', 'Accra', 'East Legon', 5.6037, -0.1870),
  (0.45, 0.60, 'Ashanti', 'Kumasi', 'Ahodwo', 6.6885, -1.6244),
  (0.60, 0.68, 'Greater Accra', 'Tema', 'Community 25', 5.6698, -0.0166),
  (0.68, 0.75, 'Central', 'Cape Coast', 'Pedu', 5.1053, -1.2466),
  (0.75, 0.82, 'Western', 'Takoradi', 'Anaji', 4.8986, -1.7554),
  (0.82, 0.87, 'Northern', 'Tamale', 'Vittin', 9.4008, -0.8393),
  (0.87, 0.91, 'Volta', 'Ho', 'Bankoe', 6.6008, 0.4713),
  (0.91, 0.95, 'Eastern', 'Koforidua', 'Adweso', 6.0940, -0.2591),
  (0.95, 0.98, 'Bono', 'Sunyani', 'Penkwase', 7.3349, -2.3123),
  (0.98, 1.01, 'Upper East', 'Bolgatanga', 'Zaare', 10.7856, -0.8514);

CREATE TEMP TABLE load_l AS
SELECT n,
  'load_l_' || lpad(n::text, 5, '0') AS id,
  'load_u_' || lpad((6 + (n - 1) % 2000)::text, 5, '0') AS host,
  CASE WHEN n <= 4200 THEN 'SHORT_STAY' WHEN n <= 4800 THEN 'TEMP_STAY' ELSE 'PERMANENT' END AS mode,
  25 + floor(pg_temp.lr('night' || n) * 200)::int AS nightly,
  250 + floor(pg_temp.lr('month' || n) * 1200)::int AS monthly,
  floor(pg_temp.lr('dep' || n) * 4)::int * 50 AS deposit,
  pg_temp.lr('city' || n) AS rc
FROM generate_series(1, 5000) n;

INSERT INTO "Listing" (id, "hostId", title, description, "propertyType", region, city, neighbourhood, lat, lng, bedrooms, bathrooms, "maxGuests",
  amenities, "rentalModes", "priceNightly", "priceMonthly", "priceAnnual", "advanceMonthsRequired", photos, "cancellationPolicy", "instantBook",
  "minStayNights", "isActive", "damageDeposit", "createdAt", "updatedAt")
SELECT l.id, l.host,
  (ARRAY['Bright', 'Quiet', 'Modern', 'Breezy', 'Spacious', 'Cosy'])[1 + floor(pg_temp.lr('adj' || l.n) * 6)::int] || ' ' ||
    (ARRAY['Apartment', 'House', 'Studio', 'Townhouse', 'Villa'])[1 + (l.n % 5)] || ' in ' || c.hood || ' ' || l.n,
  'Load-test home ' || l.n || '. Close to shops and transport, with reliable water and power backup. Not a real home.',
  (ARRAY['Apartment', 'House', 'Studio', 'Townhouse', 'Villa'])[1 + (l.n % 5)],
  c.region, c.city, c.hood,
  c.lat + (pg_temp.lr('lat' || l.n) - 0.5) * 0.12, c.lng + (pg_temp.lr('lng' || l.n) - 0.5) * 0.12,
  1 + floor(pg_temp.lr('bed' || l.n) * 4)::int, 1 + floor(pg_temp.lr('bath' || l.n) * 3)::int, 2 + floor(pg_temp.lr('guests' || l.n) * 6)::int,
  '["WiFi","Air Conditioning","Kitchen","Generator Backup"]',
  '["' || l.mode || '"]',
  CASE WHEN l.mode = 'SHORT_STAY' THEN l.nightly END,
  CASE WHEN l.mode = 'TEMP_STAY' THEN l.monthly END,
  CASE WHEN l.mode = 'PERMANENT' THEN l.monthly * 12 END,
  CASE WHEN l.mode = 'PERMANENT' THEN 3 END,
  '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80","https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80","https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80","https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80","https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80"]',
  'MODERATE', pg_temp.lr('instant' || l.n) < 0.6, 1, true, l.deposit,
  a.t - interval '1250 days', a.t - interval '1250 days'
FROM load_l l JOIN load_city c ON l.rc >= c.lo AND l.rc < c.hi, load_anchor a;

-- ── Bookings: short stays 10 per home in 20-day slots; monthly 12 per home in 100-day slots
--    (3 months each); long-term 4 per home in 400-day slots (12 months each). Slots never overlap.
CREATE TEMP TABLE load_b AS
SELECT b.*, NULL::text AS status
FROM (
  SELECT l.n, l.id AS listing, l.host, l.mode, l.deposit, k,
    'load_b_' || lpad(l.n::text, 5, '0') || '_' || lpad(k::text, 2, '0') AS id,
    'load_u_' || lpad((2006 + floor(pg_temp.lr('guest' || l.n || '_' || k) * 17995))::int::text, 5, '0') AS guest,
    CASE l.mode
      WHEN 'SHORT_STAY' THEN a.t - interval '150 days' + (k * 20 + floor(pg_temp.lr('off' || l.n || '_' || k) * 6)::int) * interval '1 day'
      WHEN 'TEMP_STAY' THEN a.t - interval '900 days' + (k * 100 + floor(pg_temp.lr('off' || l.n || '_' || k) * 3)::int) * interval '1 day'
      ELSE a.t - interval '1200 days' + (k * 400 + floor(pg_temp.lr('off' || l.n || '_' || k) * 3)::int) * interval '1 day' END AS ci,
    CASE l.mode WHEN 'SHORT_STAY' THEN 1 + floor(pg_temp.lr('nights' || l.n || '_' || k) * 7)::int WHEN 'TEMP_STAY' THEN 3 ELSE 12 END AS units,
    CASE l.mode WHEN 'SHORT_STAY' THEN l.nightly ELSE l.monthly END AS price,
    NULL::timestamp AS co
  FROM load_l l
  JOIN LATERAL generate_series(0, CASE l.mode WHEN 'SHORT_STAY' THEN 9 WHEN 'TEMP_STAY' THEN 11 ELSE 3 END) k ON true, load_anchor a
) b;
UPDATE load_b SET co = CASE mode WHEN 'SHORT_STAY' THEN ci + units * interval '1 day' ELSE ci + units * interval '1 month' END;
UPDATE load_b SET status = CASE
    WHEN co <= (SELECT t FROM load_anchor) THEN (CASE WHEN pg_temp.lr('cx' || id) < 0.15 THEN 'CANCELLED' ELSE 'COMPLETED' END)
    WHEN ci > (SELECT t FROM load_anchor) THEN (CASE WHEN mode = 'SHORT_STAY' AND pg_temp.lr('cx' || id) < 0.10 THEN 'PENDING' WHEN pg_temp.lr('cx' || id) < 0.20 THEN 'CANCELLED' ELSE 'CONFIRMED' END)
    ELSE 'CONFIRMED' END;

INSERT INTO "Booking" (id, "listingId", "guestId", "hostId", "rentalMode", "checkIn", "checkOut", "nightsOrMonths", "pricePerUnit", subtotal, "serviceFee",
  "damageDeposit", "totalPrice", status, "paymentStatus", "paymentReference", "cancellationPolicy", "cancelledBy", "cancelledAt", "createdAt", "updatedAt")
SELECT id, listing, guest, host, mode, ci, co, units, price, units * price, 0, deposit, units * price + deposit, status,
  CASE WHEN status IN ('COMPLETED', 'CONFIRMED') THEN 'PAID' ELSE 'UNPAID' END,
  CASE WHEN status IN ('COMPLETED', 'CONFIRMED') AND mode = 'SHORT_STAY' THEN 'load_ref_' || id END,
  'MODERATE',
  CASE WHEN status = 'CANCELLED' THEN 'GUEST' END,
  CASE WHEN status = 'CANCELLED' THEN ci - interval '10 days' END,
  ci - (2 + floor(pg_temp.lr('made' || id) * 40)::int) * interval '1 day',
  ci - interval '1 day'
FROM load_b;

-- ── Rent instalments: monthly stays pay 1 month up front, long-term 3; the deposit is on the first ──
CREATE TEMP TABLE load_i AS
SELECT b.id AS booking, b.host, b.status, s AS seq, 'load_i_' || substr(b.id, 8) || '_' || lpad(s::text, 2, '0') AS id,
  CASE WHEN b.mode = 'TEMP_STAY' THEN 1 ELSE 3 END AS advance,
  b.ci + (CASE WHEN s = 1 THEN 0 ELSE (s - 1) + (CASE WHEN b.mode = 'TEMP_STAY' THEN 0 ELSE 2 END) END) * interval '1 month' AS pstart,
  b.ci + (CASE WHEN s = 1 THEN (CASE WHEN b.mode = 'TEMP_STAY' THEN 1 ELSE 3 END) ELSE s + (CASE WHEN b.mode = 'TEMP_STAY' THEN 0 ELSE 2 END) END) * interval '1 month' AS pend,
  CASE WHEN s = 1 THEN (CASE WHEN b.mode = 'TEMP_STAY' THEN 1 ELSE 3 END) * b.price ELSE b.price END AS amount,
  CASE WHEN s = 1 THEN b.deposit ELSE 0 END AS deposit,
  b.ci - (2 + floor(pg_temp.lr('made' || b.id) * 40)::int) * interval '1 day' AS made
FROM load_b b JOIN LATERAL generate_series(1, CASE WHEN b.mode = 'TEMP_STAY' THEN 3 ELSE 10 END) s ON true
WHERE b.mode <> 'SHORT_STAY';

INSERT INTO "Instalment" (id, "bookingId", sequence, "periodStart", "periodEnd", "dueDate", amount, "depositAmount", status, "paidAt", "createdAt")
SELECT i.id, i.booking, i.seq, i.pstart, i.pend, CASE WHEN i.seq = 1 THEN i.made ELSE i.pstart END, i.amount, i.deposit,
  CASE WHEN i.status = 'CANCELLED' OR i.status = 'PENDING' THEN 'CANCELLED'
       WHEN i.seq = 1 OR i.pstart <= a.t THEN 'PAID' ELSE 'PENDING' END,
  CASE WHEN i.status IN ('COMPLETED', 'CONFIRMED') AND (i.seq = 1 OR i.pstart <= a.t) THEN CASE WHEN i.seq = 1 THEN i.made ELSE i.pstart END END,
  i.made
FROM load_i i, load_anchor a;

-- ── Payments: one per paid short stay, one per paid instalment; cedis at 15.5 ────────────────────
INSERT INTO "Payment" (id, "bookingId", amount, currency, method, "momoNetwork", status, "gatewayReference", "createdAt", "amountPesewas", "usdToGhs", "instalmentId")
SELECT 'load_p_' || substr(id, 8), id, units * price + deposit, 'USD', 'MOMO', 'MTN', 'SUCCESS', 'load_ref_' || id,
  ci - (2 + floor(pg_temp.lr('made' || id) * 40)::int) * interval '1 day' + interval '1 hour',
  round((units * price + deposit) * 1550)::int, 15.5, NULL
FROM load_b WHERE mode = 'SHORT_STAY' AND status IN ('COMPLETED', 'CONFIRMED');

INSERT INTO "Payment" (id, "bookingId", amount, currency, method, "momoNetwork", status, "gatewayReference", "createdAt", "amountPesewas", "usdToGhs", "instalmentId")
SELECT 'load_p_' || substr(i.id, 8), i."bookingId", i.amount + i."depositAmount", 'USD', 'MOMO', 'MTN', 'SUCCESS', 'load_ref_' || i.id,
  i."paidAt", round((i.amount + i."depositAmount") * 1550)::int, 15.5, i.id
FROM "Instalment" i WHERE i.id LIKE 'load_i_%' AND i.status = 'PAID';

-- ── Payouts: 90% of the rent, sent two days after check-in (or after the month was paid) ─────────
INSERT INTO "Payout" (id, "hostId", amount, currency, method, "momoNetwork", "momoNumber", status, "createdAt", "bookingId", "instalmentId", "instalmentSeq",
  "paystackTransferReference", "initiatedAt", "completedAt")
SELECT 'load_po_' || substr(b.id, 8), b.host, round((0.9 * b.units * b.price)::numeric, 2)::float, 'USD', 'MOMO', 'MTN', '0240000000', 'COMPLETED',
  b.ci + interval '2 days', b.id, NULL, 0, 'load_tr_' || b.id, b.ci + interval '2 days', b.ci + interval '2 days 1 minute'
FROM load_b b, load_anchor a WHERE b.mode = 'SHORT_STAY' AND b.status IN ('COMPLETED', 'CONFIRMED') AND b.ci + interval '2 days' <= a.t;

INSERT INTO "Payout" (id, "hostId", amount, currency, method, "momoNetwork", "momoNumber", status, "createdAt", "bookingId", "instalmentId", "instalmentSeq",
  "paystackTransferReference", "initiatedAt", "completedAt")
SELECT 'load_po_' || substr(i.id, 8), b."hostId", round((0.9 * i.amount)::numeric, 2)::float, 'USD', 'MOMO', 'MTN', '0240000000', 'COMPLETED',
  greatest(i."paidAt", i."dueDate") + interval '2 days', i."bookingId", i.id, i.sequence, 'load_tr_' || i.id,
  greatest(i."paidAt", i."dueDate") + interval '2 days', greatest(i."paidAt", i."dueDate") + interval '2 days 1 minute'
FROM "Instalment" i JOIN "Booking" b ON b.id = i."bookingId", load_anchor a
WHERE i.id LIKE 'load_i_%' AND i.status = 'PAID' AND greatest(i."paidAt", i."dueDate", b."checkIn") + interval '2 days' <= a.t;

-- ── Blocked dates: 200,000 days a host closed, in the gaps between the booking slots ─────────────
INSERT INTO "BlockedDate" (id, "listingId", date, reason)
SELECT 'load_bd_' || lpad(l.n::text, 5, '0') || '_' || lpad(k::text, 2, '0') || '_' || d, l.id,
  CASE l.mode
    WHEN 'SHORT_STAY' THEN a.t - interval '150 days' + (k * 20 + 14 + d) * interval '1 day'
    WHEN 'TEMP_STAY' THEN a.t - interval '900 days' + (k * 100 + 95 + d) * interval '1 day'
    ELSE a.t - interval '1200 days' + (k * 400 + 370 + d) * interval '1 day' END,
  'HOST'
FROM load_l l, load_anchor a,
  LATERAL generate_series(0, CASE l.mode WHEN 'SHORT_STAY' THEN 9 WHEN 'TEMP_STAY' THEN 11 ELSE 3 END) k,
  LATERAL generate_series(0, CASE l.mode WHEN 'SHORT_STAY' THEN 3 WHEN 'TEMP_STAY' THEN 2 ELSE 12 END) d;

-- ── Messages: two per booking, the guest and the host ────────────────────────────────────────────
INSERT INTO "Message" (id, "senderId", "receiverId", "bookingId", "listingId", content, "isRead", "createdAt")
SELECT 'load_m_' || substr(b.id, 8) || '_' || m,
  CASE WHEN m = 1 THEN b.guest ELSE b.host END, CASE WHEN m = 1 THEN b.host ELSE b.guest END, b.id, b.listing,
  CASE WHEN m = 1 THEN 'Hello, is parking available, and can we check in after 6pm? (load test)' ELSE 'Akwaaba! Yes to both. I will send directions the day before. (load test)' END,
  b.ci < a.t, b.ci - (2 + floor(pg_temp.lr('made' || b.id) * 40)::int) * interval '1 day' + m * interval '30 minutes'
FROM load_b b, load_anchor a, generate_series(1, 2) m;

-- ── Reviews: 60% of completed short stays, published; listings get their averages ────────────────
INSERT INTO "Review" (id, "bookingId", "listingId", "reviewerId", "revieweeId", rating, comment, type, "isPublished", "createdAt")
SELECT 'load_r_' || substr(b.id, 8), b.id, b.listing, b.guest, b.host, 3 + floor(pg_temp.lr('stars' || b.id) * 3)::int,
  'Clean, quiet and the host answered quickly. Would stay again. (load test)', 'GUEST_TO_HOST', true, b.co + interval '2 days'
FROM load_b b WHERE b.mode = 'SHORT_STAY' AND b.status = 'COMPLETED' AND pg_temp.lr('review' || b.id) < 0.6;

UPDATE "Listing" l SET "avgRating" = r.avg, "reviewCount" = r.n
FROM (SELECT "listingId", round(avg(rating)::numeric, 2)::float avg, count(*)::int n FROM "Review" WHERE id LIKE 'load_r_%' GROUP BY 1) r
WHERE l.id = r."listingId";

-- ── Wishlists: 30,000 hearts from guests ────────────────────────────────────────────────────────
INSERT INTO "Wishlist" (id, "userId", "listingId", "createdAt")
SELECT 'load_w_' || i, 'load_u_' || lpad((2006 + (i::bigint * 7919) % 17995)::text, 5, '0'), 'load_l_' || lpad((1 + (i::bigint * 104729) % 5000)::text, 5, '0'),
  a.t - (i % 400) * interval '1 day'
FROM generate_series(1, 30000) i, load_anchor a
ON CONFLICT ("userId", "listingId") DO NOTHING;
