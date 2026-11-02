# G5: after11b → aftercss

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.3 s → 3.5 s **over** | 3.3 s → 3.5 s **over** | 0.000 → 0.000 | 21 → 131 ms | 247 → 247 KB | 261 → 261 KB | 0.7 s → 0.6 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 3.1 s → 3.4 s **over** | 3.3 s → 3.4 s **over** | 0.000 → 0.000 | 42 → 106 ms | 204 → 204 KB | 279 → 279 KB | 0.7 s → 0.7 s |
| listing | 3.4 s → 2.8 s **over** | 3.4 s → 3.5 s **over** | 0.000 → 0.000 | 172 → 259 ms **over** | 223 → 223 KB | 299 → 299 KB | 0.7 s → 0.6 s |
| checkout | 3.1 s → 3.2 s **over** | 2.3 s → 3.2 s **over** | 0.000 → 0.000 | 23 → 116 ms | 206 → 206 KB | 280 → 280 KB | 0.5 s → 0.6 s |
| guest dashboard | 2.5 s → 2.7 s **over** | 2.7 s → 3.3 s **over** | 0.000 → 0.000 | 26 → 108 ms | 224 → 224 KB | 321 → 321 KB | 0.7 s → 0.7 s |
| host dashboard | 2.4 s → 3.4 s **over** | 2.6 s → 3.3 s **over** | 0.000 → 0.000 | 37 → 181 ms | 220 → 220 KB | 296 → 296 KB | 0.6 s → 0.6 s |
| admin | 3.1 s → 2.6 s **over** | 2.4 s → 2.6 s **over** | 0.000 → 0.000 | 47 → 149 ms | 212 → 212 KB | 287 → 287 KB | 0.5 s → 0.6 s |

## Real throttling, without → with inlined stylesheets (empty database, 3 runs)

| Page | Mobile LCP | TBT |
|---|---|---|
| home | 1.58 → 1.35 s | 36 → 21 ms |
| search with map | 1.62 → 1.33 s | 27 → 22 ms |
| listing | 1.65 → 1.41 s | 27 → 23 ms |
| checkout | 1.67 → 0.81 s | 19 → 15 ms |
| guest dashboard | 1.70 → 0.80 s | 18 → 16 ms |
| host dashboard | 1.71 → 0.81 s | 20 → 14 ms |
| admin | 1.71 → 0.81 s | 23 → 15 ms |

Decision: reverted. The agreed measure (simulated, the table above) got worse; real throttling got better.
