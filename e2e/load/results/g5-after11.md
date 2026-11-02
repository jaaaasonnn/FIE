# G5: after5 → after11

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.3 s → 3.3 s **over** | 3.3 s → 3.3 s **over** | 0.000 → 0.000 | 24 → 23 ms | 247 → 247 KB | 279 → 261 KB | 0.7 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 3.9 s → 3.6 s **over** | 4.7 s → 3.3 s **over** | 0.000 → 0.000 | 59 → 121 ms | 204 → 204 KB | 279 → 279 KB | 1.0 s → 0.7 s |
| listing | 3.7 s → 3.4 s **over** | 3.8 s → 3.5 s **over** | 0.038 → 0.000 | 245 → 147 ms | 222 → 223 KB | 316 → 299 KB | 0.8 s → 0.7 s |
| checkout | 3.9 s → 3.1 s **over** | 4.1 s → 3.1 s **over** | 0.077 → 0.000 | 65 → 25 ms | 206 → 206 KB | 279 → 280 KB | 0.8 s → 0.6 s |
| guest dashboard | 3.9 s → 2.3 s | 4.0 s → 2.6 s **over** | 0.000 → 0.000 | 59 → 38 ms | 224 → 224 KB | 321 → 321 KB | 0.8 s → 0.5 s |
| host dashboard | 4.2 s → 3.8 s **over** | 3.1 s → 3.8 s **over** | 0.176 → 0.000 | 133 → 151 ms | 220 → 220 KB | 296 → 296 KB | 0.9 s → 0.7 s |
| admin | 3.7 s → 3.1 s **over** | 3.9 s → 2.4 s | 0.000 → 0.000 | 131 → 36 ms | 212 → 212 KB | 287 → 287 KB | 0.9 s → 0.7 s |
