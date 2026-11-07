# Real-phone checklist: the installed app (stage 4)

For one **iPhone 17 Pro** (Dynamic Island, current iOS, Safari's floating toolbar) and one **Android phone with
Chrome**. Everything here is done on the phones themselves; no computer needed. It checks what the tests on the Mac
cannot: the real status bar and Dynamic Island, the home indicator, Safari's floating toolbar, the install screens, and
how each phone hands a page to Paystack and back.

Tick each line. If something looks wrong, take the screenshot named under it (iPhone: side button + volume up;
Android: power + volume down) and write one line about what you expected.

## Before you start

- [ ] FieGH's `app-shell-4` branch is on the internet at an **https** address, using **Paystack test keys** and a
      database that is **not the live one**. (The tests' local copy cannot be reached from a phone. Vercel's
      deployments have been failing since August, so this needs a working preview first.)
- [ ] You have a test guest account on that copy (email and password), and a home on it you can book for a test
      payment.
- [ ] Both phones are on Wi-Fi, not low-power mode. Write down: iOS version (Settings, General, About), Android model,
      Android version, Chrome version (Chrome, menu, Settings, About Chrome).

## 1. In the browser first (nothing installed yet)

Open the test address in **Safari** on the iPhone and in **Chrome** on Android.

- [ ] Explore loads. The "Where to?" pill is fully visible, not under the time or the Dynamic Island.
- [ ] Scroll down a long page (search results). The header slides away and comes back when you scroll up a little.
- [ ] **iPhone, Safari's floating toolbar:** with the toolbar showing at the bottom, the bottom bar (Explore,
      Wishlists, Trips, Messages, Profile) is fully visible and every tab can be tapped. Scroll so the toolbar shrinks,
      then expand it again: no tab is covered and nothing jumps.
      Screenshot if wrong: the bottom of the screen with the toolbar showing, and again with it shrunk.
- [ ] **The strip under the bottom bar:** scroll to the very bottom of a long page, then up and down quickly a few
      times. There must be no strip of the page showing below the bottom bar, between the bar and the bottom edge of
      the screen. (Seen only in the Mac's iPhone imitation before, and fixed there; never checked on a real phone.)
      Screenshot if wrong: the bottom of the screen showing the strip.
- [ ] Profile tab (signed in): near the bottom, "Add FieGH to your home screen". Tap it: the steps for iPhone and
      Android open beneath it. Tap again: they fold away.

## 2. Install it

**iPhone (Safari):**
- [ ] Tap the Share button (the square with an arrow), then **Add to Home Screen** (scroll down or tap **More** if
      you cannot see it). The name says **FieGH** and the icon shows the gold mark on a cream background, not on black.
- [ ] "Open as Web App" is on (if the screen shows it). Tap **Add**.
- [ ] On the home screen: the icon is the gold mark on cream with rounded corners, the name under it is FieGH.
      Screenshot if wrong: the home screen with the icon.

**Android (Chrome):**
- [ ] Chrome may offer "Install FieGH" by itself. If not: menu (three dots), **Add to Home screen** or **Install app**,
      then **Install**.
- [ ] The icon on the home screen (or in the app drawer) is the gold mark on cream, with nothing cut off at its edges,
      whatever shape your phone gives icons. The name is FieGH.
      Screenshot if wrong: the icon.

## 3. Open the installed app

Open FieGH from its icon on each phone.

- [ ] It opens on Explore with no browser address bar and no browser toolbar.
- [ ] **Top of the screen:** the time, signal and battery are shown above the page, not over it. Nothing of FieGH
      (the "Where to?" pill, the header, the search sheet's close button) is under the Dynamic Island or the status bar.
      Screenshot if wrong: the top of the screen on Explore, on a search page, and with the search sheet open.
- [ ] **Bottom of the screen:** the bottom bar sits just above the home indicator line (iPhone) or the gesture bar
      (Android); its labels are not under the line, and there is no empty strip below it.
- [ ] **The strip under the bottom bar** again, inside the app: scroll a long page to the end and back quickly. No
      strip of page shows below the bar.
- [ ] **Header hide and return:** on search results, scroll down: the header slides up and nothing of the page shows
      under the time or the Dynamic Island. Scroll up a little: the header comes back fully.
      Screenshot if wrong: mid-scroll, showing the top of the screen.
- [ ] **Search sheet and keyboard:** tap "Where to?". The sheet opens below the status bar. Tap the "Where" field: the
      keyboard opens, the bottom bar hides, and the field stays visible above the keyboard. Type "Accra", pick a date,
      tap Search: the results show. Close the sheet with its cross and by swiping back (iPhone, from the left edge) or
      the back gesture (Android).
- [ ] **Map:** on search results tap **Map**. The map's top bar ("Map view" and **Close**) is below the status bar.
      Tap Close.
- [ ] The Profile tab no longer shows "Add FieGH to your home screen" (it is already installed).

## 4. Back navigation (no back button in the installed app)

- [ ] Open a listing from search, then go back. **iPhone:** swipe from the left edge of the screen. Does it go back to
      the results? Write down yes or no. (If no: a back arrow in the header is stage 4b.)
- [ ] **Android:** the back gesture or button goes back to the results.
- [ ] From a listing, can you always get somewhere useful (the logo, the bottom bar where shown)? Note any page where
      you felt stuck: which page, and how you got there.

## 5. Signing in inside the installed app

- [ ] **iPhone:** the app does not share Safari's sign-in. Open Profile: it asks you to log in. Log in with the test
      guest. You land back where you were, signed in.
- [ ] **Android:** you may already be signed in (it shares Chrome's sign-in). If not, log in.
- [ ] Close the app completely (swipe it away), open it again from its icon: still signed in.

## 6. Paystack TEST payment round trip

Use the test copy only, with Paystack's **test** keys: no real money moves. Pay with a test card from Paystack's
documentation (Paystack lists them under "Test payments"; at the time of writing 4084 0840 8408 4081, CVV 408, any
future expiry date) or the test mobile money number its test page shows.

- [ ] In the installed app, book the test home for one or two nights and tap **Pay**.
- [ ] Paystack's page opens. Write down how: **inside the app**, in a **sheet over the app with a Done button**, or in
      **Safari / Chrome**. Screenshot it.
- [ ] Pay with the test card. Write down where you end up afterwards: back in the app on the booking, a FieGH page
      inside the sheet, or a FieGH log-in page.
- [ ] If you ended up on a log-in page or inside a sheet: close the sheet (Done) and look at the booking in the app.
      Tap "Check again" if it shows. The booking must end up **confirmed and paid**. Write down how long it took.
      Screenshot: the booking page at the end.
- [ ] The booking shows only once in Trips, paid once.

## 7. Offline page (aeroplane mode)

- [ ] With the app open on Explore, turn on **aeroplane mode** (and make sure Wi-Fi is off too).
- [ ] Tap a home or a bottom-bar tab. You see **"You are offline"** with "FieGH needs a connection to show homes,
      prices and bookings" and a **Try again** button, below the status bar, not a blank or error screen.
      Screenshot it.
- [ ] Tap **Try again** while still offline: the same offline page comes back (nothing breaks).
- [ ] Turn aeroplane mode off, wait for the signal, tap **Try again**: the page you wanted loads, with current prices.
- [ ] Note: the first time after installing, the offline page needs one visit online first. If you went offline at
      once and saw the phone's own error, open the app online, wait a few seconds, and try again.

## 8. Signing out

- [ ] In the installed app: Profile, **Sign out**. You are signed out, and Profile asks you to log in.
- [ ] **iPhone:** Safari is not affected (it has its own sign-in). **Android:** Chrome may be signed out too
      (shared). Write down what you see.
- [ ] Sign in again, then from another device or the browser use "sign out everywhere" (if you test it): the app asks
      you to log in at its next page.

## 9. Uninstall (when done)

- [ ] iPhone: press and hold the icon, Remove App, Delete from Home Screen. Android: press and hold, Uninstall.

## What to send back

The ticked list, the lines you wrote, and the screenshots, named after the step (for example `3-top-search.png`).
