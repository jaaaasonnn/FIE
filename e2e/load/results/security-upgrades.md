# Security upgrades: speed before and after (2026-11-02, branch `security-upgrades`)

Before: `msfontrevert` (main at `2c51a84`). After: `mssecurity` (`84e6764`: Next 16.4.3, maplibre 6.16 with
react-map-gl 8.1.3, @sentry/nextjs 10.78, the map's credits). Real throttling (E2E_LH_THROTTLING=devtools: slow 4G
and a CPU 4x slower), empty database, 3 runs, median; mains power, `caffeinate -dims`.

| Page | Mobile LCP | Mobile TBT | CLS | JS (Lighthouse, mobile) | Desktop LCP |
|---|---|---|---|---|---|
| home (unchanged, redesign pending) | 1.58 → 1.61 s | 36 → 31 ms | 0 → 0 | 261 → 257 KB | 0.09 → 0.13 s |
| search with map | 1.64 → 1.67 s | 25 → 31 ms | 0 → 0 | 279 → 274 KB | 0.18 → 0.17 s |
| listing | 1.69 → 1.71 s | 30 → 33 ms | 0 → 0 | 299 → 293 KB | 0.15 → 0.16 s |
| checkout | 1.74 → 1.73 s | 23 → 32 ms | 0 → 0 | 280 → 274 KB | 0.14 → 0.15 s |
| guest dashboard | 1.73 → 1.76 s | 25 → 27 ms | 0 → 0 | 321 → 315 KB | 0.14 → 0.16 s |
| host dashboard | 1.73 → 1.74 s | 25 → 27 ms | 0 → 0 | 300 → 294 KB | 0.17 → 0.21 s |
| admin | 1.68 → 1.73 s | 16 → 29 ms | 0 → 0 | 287 → 281 KB | 0.12 → 0.14 s |

Every difference is within the run-to-run spread. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms: all met.

Bundle guard (compressed script on first load, prefetches left out):

| | G5 final | Next | maplibre 6 | Sentry 10.78 | credits |
|---|---|---|---|---|---|
| phone, per page | 204-247 KB | 202-245 KB | 202-245 KB | 200-243 KB | 200-243 KB |
| desktop search with the map (cap 650 KB) | 484 KB | 482 KB | **649 KB** | 647 KB | **647 KB** |
| of which the map | 280 KB | 279 KB | 447 KB (302 KB script + 145 KB worker) | 447 KB | 447 KB |

maplibre 6's worker is a separate file the worker fetches (maplibre 5 carried it inside its script); the guard
counts it from the file since this branch. Lighthouse does not see it, so its desktop map figure (282 → 307 KB) is
the script alone.
