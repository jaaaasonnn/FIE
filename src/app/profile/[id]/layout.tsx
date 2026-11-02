import { BottomBar } from '@/components/layout/BottomBar'

// A public profile: the phone's bottom bar (components/layout/BottomBar.tsx), drawn on the server around the page.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<BottomBar /></>
}
