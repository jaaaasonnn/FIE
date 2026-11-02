import { BottomBar } from '@/components/layout/BottomBar'

// The host's messages: the phone's bottom bar (components/layout/BottomBar.tsx), drawn on the server around the page.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<BottomBar active="messages" /></>
}
