// The phone's bottom bar (components/layout/BottomBar.tsx): what the page's head runs to load its one piece
// of browser code, the unread badge (public/bar.js). Below 768 px only, so a desktop never downloads it.
// A module, like the chunk guard, so the page is not held at it while the stylesheets load.
export const PHONE_MAX_WIDTH = 767
export const BAR_LOADER_SCRIPT = `if(window.matchMedia&&matchMedia('(max-width: ${PHONE_MAX_WIDTH}px)').matches){var s=document.createElement('script');s.src='/bar.js';s.async=true;document.head.appendChild(s)}`
