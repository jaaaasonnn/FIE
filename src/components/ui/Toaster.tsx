'use client'

export function Toaster() {
  return (
    <div id="toast-root" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" />
  )
}

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  if (typeof window === 'undefined') return
  const root = document.getElementById('toast-root')
  if (!root) return

  const toast = document.createElement('div')
  const colors = {
    success: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
    error: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
    info: { bg: '#FBE8BB', text: '#92400E', border: '#F5C06A' },
  }
  const c = colors[type]
  toast.style.cssText = `
    background:${c.bg}; color:${c.text}; border:1px solid ${c.border};
    padding:12px 16px; border-radius:10px; font-size:14px; font-family:'DM Sans',sans-serif;
    box-shadow:0 4px 12px rgba(0,0,0,0.12); pointer-events:auto;
    transform:translateX(100px); opacity:0; transition:all 0.3s ease;
    max-width:320px; line-height:1.4;
  `
  toast.textContent = message
  root.appendChild(toast)

  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(0)'
    toast.style.opacity = '1'
  })

  setTimeout(() => {
    toast.style.transform = 'translateX(100px)'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 3500)
}
