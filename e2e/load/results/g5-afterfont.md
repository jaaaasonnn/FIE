# G5: after11b → afterfont

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.3 s → 3.3 s **over** | 3.3 s → 3.3 s **over** | 0.000 → 0.000 | 21 → 17 ms | 247 → 247 KB | 261 → 261 KB | 0.7 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 3.1 s → 3.1 s **over** | 3.3 s → 3.2 s **over** | 0.000 → 0.000 | 42 → 18 ms | 204 → 204 KB | 279 → 279 KB | 0.7 s → 0.7 s |
| listing | 3.4 s → 3.4 s **over** | 3.4 s → 3.5 s **over** | 0.000 → 0.000 | 172 → 28 ms | 223 → 223 KB | 299 → 299 KB | 0.7 s → 0.6 s |
| checkout | 3.1 s → 2.4 s | 2.3 s → 2.4 s | 0.000 → 0.000 | 23 → 31 ms | 206 → 206 KB | 280 → 280 KB | 0.5 s → 0.5 s |
| guest dashboard | 2.5 s → 3.2 s **over** | 2.7 s → 2.6 s **over** | 0.000 → 0.000 | 26 → 32 ms | 224 → 224 KB | 321 → 321 KB | 0.7 s → 0.6 s |
| host dashboard | 2.4 s → 2.4 s | 2.6 s → 3.4 s **over** | 0.000 → 0.000 | 37 → 19 ms | 220 → 220 KB | 296 → 296 KB | 0.6 s → 0.5 s |
| admin | 3.1 s → 3.1 s **over** | 2.4 s → 2.4 s | 0.000 → 0.000 | 47 → 31 ms | 212 → 212 KB | 287 → 287 KB | 0.5 s → 0.5 s |

Notes: the logo font change shows no gain beyond the run-to-run spread (simulated LCP for these pages lands at about 2.4 or about 3.1 s depending on when the scripts started in the recording); kept because the owner chose to keep Unbounded and stop preloading it. Package removal changes no page.
