# G5: before → after11b

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.6 s → 3.3 s **over** | 3.6 s → 3.3 s **over** | 0.000 → 0.000 | 41 → 21 ms | 327 → 247 KB | 320 → 261 KB | 0.6 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 4.5 s → 3.1 s **over** | 7.3 s → 3.3 s **over** | 0.000 → 0.000 | 193 → 42 ms | 565 → 204 KB | 604 → 279 KB | 1.5 s → 0.7 s |
| listing | 4.2 s → 3.4 s **over** | 4.2 s → 3.4 s **over** | 0.038 → 0.000 | 78 → 172 ms | 347 → 223 KB | 354 → 299 KB | 0.9 s → 0.7 s |
| checkout | 4.1 s → 3.1 s **over** | 4.1 s → 2.3 s | 0.077 → 0.000 | 67 → 23 ms | 286 → 206 KB | 320 → 280 KB | 0.9 s → 0.5 s |
| guest dashboard | 3.8 s → 2.5 s | 4.2 s → 2.7 s **over** | 0.000 → 0.000 | 63 → 26 ms | 304 → 224 KB | 361 → 321 KB | 0.8 s → 0.7 s |
| host dashboard | 4.4 s → 2.4 s | 3.3 s → 2.6 s **over** | 0.176 → 0.000 | 71 → 37 ms | 300 → 220 KB | 336 → 296 KB | 1.0 s → 0.6 s |
| admin | 4.4 s → 3.1 s **over** | 4.8 s → 2.4 s | 0.000 → 0.000 | 64 → 47 ms | 309 → 212 KB | 343 → 287 KB | 1.0 s → 0.5 s |

## Real throttling (E2E_LH_THROTTLING=devtools), empty database, 3 runs, median

The page is really slowed to the same line and CPU instead of simulated. Lighthouse's simulation counts every script that started before the content was painted, even ones that do not hold it up, so its LCP for these pages lands where the scripts finish (2.1 to 3.4 s); in its own recording LCP is the first paint.

| Page | Mobile LCP | Mobile FCP | CLS |
|---|---|---|---|
| home | 1.6 s | 1.6 s | 0.000 |
| search with map | 1.6 s | 1.6 s | 0.000 |
| listing | 1.7 s | 1.7 s | 0.000 |
| checkout | 1.7 s | 1.7 s | 0.000 |
| guest dashboard | 1.7 s | 1.7 s | 0.000 |
| host dashboard | 1.7 s | 1.7 s | 0.000 |
| admin | 1.7 s | 1.7 s | 0.000 |

The harness serves small generated photos, so the image pages (home, search, listing) do not show a real photo's weight here.
