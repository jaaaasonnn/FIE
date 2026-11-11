# Bottom-bar tabs: server time (after)

Build: with one session read per page drawn (`lib/session.ts`, React `cache`), 2026-11-11. Its query lists wait 1.5 s more, so they include what the browser fetches afterwards (the unread badge's session read and count, Wishlists' and the inbox's data). Trips' server render now reads the session once: the batched second read (`... "t0"."token" FROM "public"."Session"`) is gone.

Lane app http://localhost:3204, a guest with 3 bookings (1 paid), 3 saved homes, 1 conversation. Median / 90th percentile, ms.

## A tap on the tab (390 px, Chromium; the RSC answers for the move, prefetches left out)

| Tab | 0 ms: answers done / page drawn | 5-15 ms: answers done / page drawn | trips one after another | the RSC requests (one round at 5-15 ms) |
|---|---|---|---|---|
| Trips | 87 / 87 | 187 / 191 | 10.0 |  |
| Wishlists | 42 / 41 | 57 / 54 | 1.5 |  |
| Messages | 76 / 83 | 129 / 140 | 5.4 | /dashboard/guest/messages 10 ms |
| Profile | 63 / 63 | 130 / 127 | 6.7 |  |
| Explore | 56 / 54 | 66 / 62 | 0.9 |  |

## Full page loads and the API routes behind them (no browser)

| What | 0 ms to the database | 5-15 ms (REALISTIC) | trips one after another (difference / 10 ms) |
|---|---|---|---|
| Trips (full load) | 36 / 38 | 140 / 147 | 10.4 |
| Wishlists (full load) | 2 / 4 | 3 / 5 | 0.1 |
| Messages (full load) | 19 / 20 | 66 / 72 | 4.7 |
| Messages (after the redirect) (full load) | 2 / 3 | 2 / 3 | -0.0 |
| Profile (full load) | 19 / 21 | 70 / 78 | 5.1 |
| Explore (full load) | 2 / 3 | 2 / 2 | -0.0 |
| /api/auth/session | 15 / 16 | 65 / 74 | 5.0 |
| /api/notifications | 32 / 35 | 131 / 137 | 9.9 |
| /api/bookings?guestId=ID | 31 / 34 | 129 / 140 | 9.8 |
| /api/wishlists?userId=ID | 33 / 35 | 133 / 137 | 9.9 |
| /api/reviews?reviewerId=ID | 17 / 17 | 63 / 75 | 4.6 |
| /api/messages | 32 / 38 | 127 / 131 | 9.4 |
| /api/reviews?mine=true | 32 / 34 | 122 / 133 | 9.1 |
| /api/messages/unread | 32 / 34 | 128 / 134 | 9.5 |

## Queries (pg_stat_statements, one tap each, with what the page then fetches; Prisma joins the relations of an include into one query and batches the same findUnique made at once)

### Trips: 13 statements (the page and what the browser then asks for)

- 4 x `SELECT $1`
- 2 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT "t0"."id", "t0"."bookingId", "t0"."listingId", "t0"."reviewerId", "t0"."revieweeId", "t0"."rating", "t0"."comment", "t0"."type", "t0"."isPublished", "t0"."hostRepl`
- 1 x `SELECT "t0"."id", "t0"."bookingId", "t0"."type", "t0"."rating", "t0"."isPublished", "t0"."createdAt" FROM "public"."Review" AS "t0" WHERE "t0"."reviewerId" = $1 ORDER BY `
- 1 x `SELECT "t0"."id", "t0"."listingId", "t0"."guestId", "t0"."hostId", "t0"."rentalMode", "t0"."checkIn", "t0"."checkOut", "t0"."nightsOrMonths", "t0"."pricePerUnit", "t0"."s`
- 1 x `SELECT "t0"."id", "t0"."senderId", "t0"."receiverId", "t0"."bookingId", "t0"."listingId", "t0"."content", "t0"."isRead", "t0"."createdAt", "Message_sender"."__prisma_data`
- 1 x `SELECT "t0"."id", "t0"."userId", "t0"."listingId", "t0"."createdAt", "Wishlist_listing"."__prisma_data__" AS "listing" FROM "public"."Wishlist" AS "t0" LEFT JOIN LATERAL `
- 1 x `SELECT "t0"."id", "t0"."userId", "t0"."type", "t0"."title", "t0"."body", "t0"."readAt", "t0"."createdAt" FROM "public"."Notification" AS "t0" WHERE ("t0"."userId" = $1 AN`
- 1 x `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Message"."id" FROM "public"."Message" WHERE ("public"."Message"."receiverId" = $1 AND "public"."Message"."isRead" `

### Wishlists: 4 statements (the page and what the browser then asks for)

- 2 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT "t0"."id", "t0"."userId", "t0"."listingId", "t0"."createdAt", "Wishlist_listing"."__prisma_data__" AS "listing" FROM "public"."Wishlist" AS "t0" LEFT JOIN LATERAL `
- 1 x `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Message"."id" FROM "public"."Message" WHERE ("public"."Message"."receiverId" = $1 AND "public"."Message"."isRead" `

### Messages: 5 statements (the page and what the browser then asks for)

- 3 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT "t0"."id", "t0"."senderId", "t0"."receiverId", "t0"."bookingId", "t0"."listingId", "t0"."content", "t0"."isRead", "t0"."createdAt", "Message_sender"."__prisma_data`
- 1 x `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Message"."id" FROM "public"."Message" WHERE ("public"."Message"."receiverId" = $1 AND "public"."Message"."isRead" `

### Profile: 3 statements (the page and what the browser then asks for)

- 2 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Message"."id" FROM "public"."Message" WHERE ("public"."Message"."receiverId" = $1 AND "public"."Message"."isRead" `

### Explore: 3 statements (the page and what the browser then asks for)

- 1 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT $1`
- 1 x `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Message"."id" FROM "public"."Message" WHERE ("public"."Message"."receiverId" = $1 AND "public"."Message"."isRead" `

