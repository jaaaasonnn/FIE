# Bottom-bar tabs: server time (before)

Build: `src/` as committed at `27bc868` (2026-11-10). Its query lists were read straight after the page settled, so they hold the page's own server work and not always the browser's fetches after it.

Lane app http://localhost:3204, a guest with 3 bookings (1 paid), 3 saved homes, 1 conversation. Median / 90th percentile, ms.

## A tap on the tab (390 px, Chromium; the RSC answers for the move, prefetches left out)

| Tab | 0 ms: answers done / page drawn | 5-15 ms: answers done / page drawn | trips one after another | the RSC requests (one round at 5-15 ms) |
|---|---|---|---|---|
| Trips | 98 / 98 | 278 / 274 | 18.0 | /dashboard/guest 196 ms |
| Wishlists | 47 / 47 | 55 / 52 | 0.8 |  |
| Messages | 75 / 81 | 137 / 147 | 6.2 | /dashboard/guest/messages 12 ms |
| Profile | 63 / 60 | 125 / 117 | 6.2 |  |
| Explore | 56 / 53 | 60 / 56 | 0.4 |  |

## Full page loads and the API routes behind them (no browser)

| What | 0 ms to the database | 5-15 ms (REALISTIC) | trips one after another (difference / 10 ms) |
|---|---|---|---|
| Trips (full load) | 50 / 51 | 203 / 215 | 15.3 |
| Wishlists (full load) | 2 / 2 | 2 / 3 | 0.1 |
| Messages (full load) | 18 / 20 | 70 / 81 | 5.1 |
| Messages (after the redirect) (full load) | 2 / 3 | 2 / 3 | -0.1 |
| Profile (full load) | 19 / 20 | 70 / 79 | 5.1 |
| Explore (full load) | 3 / 8 | 2 / 3 | -0.1 |
| /api/auth/session | 15 / 16 | 63 / 69 | 4.7 |
| /api/notifications | 31 / 34 | 129 / 139 | 9.9 |
| /api/bookings?guestId=ID | 31 / 37 | 130 / 138 | 9.8 |
| /api/wishlists?userId=ID | 35 / 42 | 132 / 134 | 9.7 |
| /api/reviews?reviewerId=ID | 16 / 17 | 66 / 74 | 4.9 |
| /api/messages | 31 / 33 | 129 / 138 | 9.8 |
| /api/reviews?mine=true | 33 / 35 | 126 / 135 | 9.2 |
| /api/messages/unread | 33 / 34 | 126 / 138 | 9.3 |

## Queries (pg_stat_statements, one tap each; Prisma runs each relation of an include as its own query)

### Trips: 11 statements (the page and what the browser then asks for)

- 3 x `SELECT $1`
- 1 x `SELECT "t0"."id", "t0"."bookingId", "t0"."listingId", "t0"."reviewerId", "t0"."revieweeId", "t0"."rating", "t0"."comment", "t0"."type", "t0"."isPublished", "t0"."hostRepl`
- 1 x `SELECT "t0"."id", "t0"."bookingId", "t0"."type", "t0"."rating", "t0"."isPublished", "t0"."createdAt" FROM "public"."Review" AS "t0" WHERE "t0"."reviewerId" = $1 ORDER BY `
- 1 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`
- 1 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user", "t0"."token" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSON`
- 1 x `SELECT "t0"."id", "t0"."listingId", "t0"."guestId", "t0"."hostId", "t0"."rentalMode", "t0"."checkIn", "t0"."checkOut", "t0"."nightsOrMonths", "t0"."pricePerUnit", "t0"."s`
- 1 x `SELECT "t0"."id", "t0"."senderId", "t0"."receiverId", "t0"."bookingId", "t0"."listingId", "t0"."content", "t0"."isRead", "t0"."createdAt", "Message_sender"."__prisma_data`
- 1 x `SELECT "t0"."id", "t0"."userId", "t0"."listingId", "t0"."createdAt", "Wishlist_listing"."__prisma_data__" AS "listing" FROM "public"."Wishlist" AS "t0" LEFT JOIN LATERAL `
- 1 x `SELECT "t0"."id", "t0"."userId", "t0"."type", "t0"."title", "t0"."body", "t0"."readAt", "t0"."createdAt" FROM "public"."Notification" AS "t0" WHERE ("t0"."userId" = $1 AN`

### Wishlists: 0 statements (the page and what the browser then asks for)


### Messages: 1 statements (the page and what the browser then asks for)

- 1 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`

### Profile: 1 statements (the page and what the browser then asks for)

- 1 x `SELECT "t0"."id", "t0"."expiresAt", "t0"."userId", "Session_user"."__prisma_data__" AS "user" FROM "public"."Session" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT`

### Explore: 0 statements (the page and what the browser then asks for)


