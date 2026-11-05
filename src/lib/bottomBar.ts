// The phone's bottom bar (components/layout/BottomBar.tsx) and the search sheet (components/search/SearchSheet.tsx):
// what the page's head runs to load their browser code, the unread badge (public/bar.js) and the sheet's
// behaviour (public/sheet.js). Below 768 px only, so a desktop never downloads either.
// A module, like the chunk guard, so the page is not held at it while the stylesheets load.
export const PHONE_MAX_WIDTH = 767
export const PHONE_SCRIPTS = ['/bar.js', '/sheet.js']
export const BAR_LOADER_SCRIPT = `if(window.matchMedia&&matchMedia('(max-width: ${PHONE_MAX_WIDTH}px)').matches){${JSON.stringify(PHONE_SCRIPTS)}.forEach(function(u){var s=document.createElement('script');s.src=u;s.async=true;document.head.appendChild(s)})}`
