# Findings from the end-to-end tests

Working list, kept as the tests are written. Nothing under `src/` has been
changed for any of these. A test marked `test.fail()` with the finding's
number expects the right behaviour and fails today; it starts passing (and
the mark must then be removed) once the fix is in.

| # | Rank | What | How to see it | Test |
|---|---|---|---|---|
| F1 | Medium | After logging in from a link that carries `?redirect=`, the person lands on their dashboard, not where they were going. `src/app/login/page.tsx`: the "already logged in" effect fires as soon as sign-in sets the user and its `router.replace(dashboard)` wins over the one in `handleLogin`. So a signed-out person who opens a checkout, booking or pay link (the proxy sends them to `/login?redirect=…`) loses their place. | Signed out, open `/login?redirect=/faq`, log in: you arrive on `/dashboard/guest`. | `tests/navigation/deep-links.spec.ts` |
