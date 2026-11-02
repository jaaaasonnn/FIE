# G5: before → final (`38a9975` → the end of `mobile-speed`)

Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ 350 KB (desktop search with its map ≤ 650 KB). Each cell is before → after.

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.6 s → 3.3 s **over** | 3.6 s → 3.3 s **over** | 0.000 → 0.000 | 41 → 17 ms | 327 → 247 KB | 320 → 261 KB | 0.6 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 4.5 s → 3.1 s **over** | 7.3 s → 3.2 s **over** | 0.000 → 0.000 | 193 → 18 ms | 565 → 204 KB | 604 → 279 KB | 1.5 s → 0.7 s |
| listing | 4.2 s → 3.4 s **over** | 4.2 s → 3.5 s **over** | 0.038 → 0.000 | 78 → 28 ms | 347 → 223 KB | 354 → 299 KB | 0.9 s → 0.6 s |
| checkout | 4.1 s → 2.4 s | 4.1 s → 2.4 s | 0.077 → 0.000 | 67 → 31 ms | 286 → 206 KB | 320 → 280 KB | 0.9 s → 0.5 s |
| guest dashboard | 3.8 s → 3.2 s **over** | 4.2 s → 2.6 s **over** | 0.000 → 0.000 | 63 → 32 ms | 304 → 224 KB | 361 → 321 KB | 0.8 s → 0.6 s |
| host dashboard | 4.4 s → 2.4 s | 3.3 s → 3.4 s **over** | 0.176 → 0.000 | 71 → 19 ms | 300 → 220 KB | 336 → 296 KB | 1.0 s → 0.5 s |
| admin | 4.4 s → 3.1 s **over** | 4.8 s → 2.4 s | 0.000 → 0.000 | 64 → 31 ms | 309 → 212 KB | 343 → 287 KB | 1.0 s → 0.5 s |


The home page's code is not changed in this branch (its redesign is next): its figures moved only with the shared changes. Report it as unchanged, redesign pending.

Simulated LCP for the server-first pages lands at about 2.4 or about 3.1 s from run to run: Lighthouse's simulation counts every script that started before the content was painted, even ones that do not hold it up. In its own recording LCP is the first paint. The table below is the check.

## Real throttling (E2E_LH_THROTTLING=devtools: slow 4G and a CPU 4x slower applied to the browser), empty database, 3 runs, median

| Page | Mobile LCP | Mobile CLS | Mobile TBT | Desktop LCP |
|---|---|---|---|---|
| home (unchanged, redesign pending) | 1.57 → 1.55 s | 0.000 → 0.000 | 62 → 40 ms | 0.09 → 0.08 s |
| search with map | 5.34 → 1.60 s | 0.000 → 0.000 | 143 → 15 ms | 0.17 → 0.16 s |
| listing | 5.04 → 1.63 s | 0.038 → 0.000 | 62 → 15 ms | 0.20 → 0.12 s |
| checkout | 3.90 → 1.65 s | 0.077 → 0.000 | 52 → 22 ms | 0.19 → 0.13 s |
| guest dashboard | 3.99 → 1.67 s | 0.000 → 0.000 | 48 → 24 ms | 0.16 → 0.12 s |
| host dashboard | 4.59 → 1.66 s | 0.123 → 0.000 | 50 → 23 ms | 0.22 → 0.15 s |
| admin | 4.03 → 1.66 s | 0.000 → 0.000 | 50 → 22 ms | 0.19 → 0.11 s |

The harness serves small generated photos, so the image pages (home, search, listing) do not carry a real photo's weight here; on the real site their LCP is the first photo's download.
