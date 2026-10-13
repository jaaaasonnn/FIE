# Text contrast: applied

This was a proposal. It was approved and applied on 2026-10-13, with these
answers: the grey is `#736D62`; the line in the checkout's gold bar is dark and
the bar is unchanged; the green and the red were done too. No brand colour
changed: the gold `#C9932E`, the logo, `#FAF7F2` and Manrope are as they were.

## The result

Measured by the same scanner (axe, WCAG 2.1 A and AA) before and after, on a
build of each.

| | Before | After |
|---|---|---|
| Text below 4.5 to 1, on the 47 pages | 252 elements on 47 pages | 0 |
| Other failures on those pages (the step bar, the FAQ list) | 10 elements on 2 pages | 0 |
| The 12 main states the scan now also opens | not scanned before | 0 |

`a11y-baseline.json` is now empty for all four kinds of visitor, so the scan
fails on any failure at all.

The 12 states: search with filters open; the FAQ with an answer open; a
listing with the calendar open; checkout paying by card; payouts with the
payout form open, for MoMo and for a bank; and "new listing" with its error
shown and at each of its six steps.

Three places were changed beyond the five named for change 4, because the
wider scan found the same failure in them: the selected cancellation policy on
"new listing", the selected button in the payout method form, and the Filters
button on search while open. They are in a commit of their own.

Pictures of seven pages, each from a real build before and after, are in
`proposals/contrast/`: `home`, `listing`, `checkout`, `guest-dashboard`,
`host-dashboard`, `admin-users` and `payouts`, each as `-before.jpg` and
`-after.jpg`. To take them again: `E2E_SHOTS=after node e2e/run.mjs test
tests/a11y/contrast-shots.spec.ts --project=chromium --workers=1`.

Still not measured: text that only appears after something happens that the
scan does not do (dialogs, error messages other than the one on "new
listing", a selected amenity), text over a photo, and placeholder text.

The proposal as it was written follows.

## What was measured

The rule is WCAG 2.1 AA: ordinary text needs a contrast of at least 4.5 to 1
against its background.

| | Now | With the proposal |
|---|---|---|
| Pages with text below 4.5 to 1 | 47 of 47 | 0 of 47 |
| Elements below 4.5 to 1 | 224 | 0 |

Both columns were measured by the same scanner (axe) on the same pages, in one
run. For the second column the proposed colours were applied in the browser
only. The count of elements moves a little between runs (252 on the run
before) because the admin lists change length; the kinds of colour do not.

## The seven changes

All of the failures come from seven colours. They are listed with the most
common first.

| # | Where | Now | Proposed | Ratio now | Ratio after | Elements |
|---|---|---|---|---|---|---|
| 1 | Footer small print, and one line in the admin header: cream at 40% on the dark surface | `rgba(250,247,242,0.4)` | `rgba(250,247,242,0.5)` | 3.60 | 5.07 | 153, on every page |
| 2 | The muted text token `--color-text-muted` | `#9C9589` | `#736D62` | 2.96 on white, 2.78 on the page background | 5.13 and 4.80 | 11 |
| 3 | Small grey text written with Tailwind's `text-stone-400`, on light backgrounds | `#A6A09B` | `#736D62` (the same grey as 2) | 2.27 to 2.58 | 4.80 to 5.13 | 50 |
| 4 | Gold used as a text colour on a light background | `#C9932E` (`--color-accent`) | `#8A5E10` (`--color-accent-deep`, already a token) | 2.31 to 2.72 | 4.84 to 5.69 | 5 |
| 5 | Green text for a role chip and one figure | `#059669` | `#047857` | 3.59 and 3.76 | 5.24 and 5.48 | 3 |
| 6 | The line under the heading in the checkout's gold bar: white at 75% on gold | `rgba(255,255,255,0.75)` | `#1F1B16` (`--color-text-primary`) | 2.17 | 6.27 | 1 |
| 7 | One red text button on the page background | `text-red-600` | `text-red-700` | 4.46 | 6.01 | 1 |

What each one touches in the source:

1. Three lines: `src/components/layout/Footer.tsx` (two) and `src/app/admin/page.tsx` (one).
2. One line in `src/app/globals.css`. The token is used in 17 places.
3. 41 uses of `text-stone-400` in 17 files. Two of them sit on a dark surface (the two buttons in the dark header of the edit-listing page) and must keep their light colour, so this cannot be done by changing the Tailwind colour itself: each use on a light background is changed.
4. Five places: the selected payment method at checkout, the selected rental type when editing a listing, "Total Earned" on the payouts page, one link on the guest dashboard and one on the host dashboard. The gold itself does not change, and stays as it is on buttons, borders, icons and anything on a dark surface.
5. The role chip in the admin Users tab and one figure on the payouts page. `#059669` appears 15 times in the source; only text on a light background needs the darker green.
6. One line in `src/app/checkout/[id]/page.tsx`. The heading above it is already dark, so the bar then reads in one colour.
7. One button on the edit-listing page.

## What it looks like

The changes are small on purpose. Each pair is the same page, before and after.

| Page | Shows | Before | After |
|---|---|---|---|
| Home | 1 (footer) | [before](proposals/contrast/home-before.jpg) | [after](proposals/contrast/home-after.jpg) |
| Guest dashboard | 2, 3, 4 | [before](proposals/contrast/guest-dashboard-before.jpg) | [after](proposals/contrast/guest-dashboard-after.jpg) |
| Checkout | 2, 4, 6 | [before](proposals/contrast/checkout-before.jpg) | [after](proposals/contrast/checkout-after.jpg) |
| Host dashboard | 3, 4 | [before](proposals/contrast/host-dashboard-before.jpg) | [after](proposals/contrast/host-dashboard-after.jpg) |
| Payouts | 3, 4, 5 | [before](proposals/contrast/payouts-before.jpg) | [after](proposals/contrast/payouts-after.jpg) |
| Admin, Users tab | 3, 5 | [before](proposals/contrast/admin-users-before.jpg) | [after](proposals/contrast/admin-users-after.jpg) |

## Decisions for you

1. **The grey for 2 and 3.** I recommend `#736D62`: it passes with a little room on white (5.13), on the page background (4.80) and on the pale tints (4.87 to 4.91), and muted text stays visibly lighter than secondary text (`#6B645C`). It does not pass on the gold tint `#F5ECD6` (4.36); no muted text was found on that tint. The alternative is to use `#6B645C` for both, which adds no new colour but makes muted and secondary text the same.
2. **The checkout bar (6).** I recommend dark text on the gold, which matches the gold buttons. The alternative is to keep white text and darken the bar to `#8A5E10`, which changes the look of the page more.
3. **Whether to do 5 and 7 now.** They are three elements and one element. They can wait without much harm.

## Limits

- The scanner sees a page as it loads. Text that appears later (a dialog, a later step of the listing form, an error message) was not measured. Changes 2 and 3 cover most of it, because the same two greys are used there.
- Placeholder text in fields is not checked by this rule. Two fields use `placeholder:text-stone-400`.
- Text over a photo or a gradient cannot be measured by the scanner and was not.
