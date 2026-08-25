import { redirect } from 'next/navigation'

// This page is a deliberate leftover from an earlier, now-abandoned auth
// iteration — /login is the actively maintained sign-in/sign-up flow (see
// Navbar.tsx, HostCTASection.tsx, etc.). Kept as a redirect rather than
// deleted outright in case anything external or bookmarked still links
// here; every real in-app link was updated to point at /login directly.
//
// Forwards ?role=host (the one param anything ever actually linked here
// with — "Become a Host" CTAs) so a bookmarked link still lands on the
// same pre-filled signup state /login's own links produce.
export default async function SignUpRedirect({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const { role } = await searchParams
  const qs = new URLSearchParams({ tab: 'signup' })
  if (role === 'host') qs.set('role', 'host')
  redirect(`/login?${qs.toString()}`)
}
