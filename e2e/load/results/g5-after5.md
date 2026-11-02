# G5: before → after5

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.6 s → 3.3 s **over** | 3.6 s → 3.3 s **over** | 0.000 → 0.000 | 41 → 24 ms | 327 → 247 KB | 320 → 279 KB | 0.6 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 4.5 s → 3.9 s **over** | 7.3 s → 4.7 s **over** | 0.000 → 0.000 | 193 → 59 ms | 565 → 204 KB | 604 → 279 KB | 1.5 s → 1.0 s |
| listing | 4.2 s → 3.7 s **over** | 4.2 s → 3.8 s **over** | 0.038 → 0.038 | 78 → 245 ms **over** | 347 → 222 KB | 354 → 316 KB | 0.9 s → 0.8 s |
| checkout | 4.1 s → 3.9 s **over** | 4.1 s → 4.1 s **over** | 0.077 → 0.077 | 67 → 65 ms | 286 → 206 KB | 320 → 279 KB | 0.9 s → 0.8 s |
| guest dashboard | 3.8 s → 3.9 s **over** | 4.2 s → 4.0 s **over** | 0.000 → 0.000 | 63 → 59 ms | 304 → 224 KB | 361 → 321 KB | 0.8 s → 0.8 s |
| host dashboard | 4.4 s → 4.2 s **over** | 3.3 s → 3.1 s **over** | 0.176 → 0.176 **over** | 71 → 133 ms | 300 → 220 KB | 336 → 296 KB | 1.0 s → 0.9 s |
| admin | 4.4 s → 3.7 s **over** | 4.8 s → 3.9 s **over** | 0.000 → 0.000 | 64 → 131 ms | 309 → 212 KB | 343 → 287 KB | 1.0 s → 0.9 s |
