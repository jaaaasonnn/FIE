import { redirect } from 'next/navigation'

// This page is a deliberate leftover from an earlier, now-abandoned auth
// iteration — /login is the actively maintained sign-in/sign-up flow (see
// Navbar.tsx, HostCTASection.tsx, etc.). Kept as a redirect rather than
// deleted outright in case anything external or bookmarked still links
// here; every real in-app link was updated to point at /login directly.
export default function SignInRedirect() {
  redirect('/login')
}
