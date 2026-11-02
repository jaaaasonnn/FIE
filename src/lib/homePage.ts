// G10: the home page's hero shows live listings, and the page is kept ready
// made between visits. After anything that could add a listing to it or take
// one away (a new or edited listing, its photos, a hold, a suspension), the
// page is drawn again on its next visit, so a home that is off, on hold or
// suspended does not stay there. The timed refresh in src/app/page.tsx is the
// backstop for anything else (a new review changing the order).
//
// SU6: usually at once, at most a minute. Next stamps a page it keeps with the moment it was stored, not the
// moment its data was read, and a mark expires only copies stored before it. A visit that read the listings
// just before the change and stored the page just after the mark is kept as fresh until the timed refresh
// (60 s). Marking again a moment later does not close this: from after() Next applies the marks only when all
// of that work ends, and waiting a second inside the request still left copies behind (REPORT.md).

import { revalidatePath } from 'next/cache'

/** Called after the change has been committed. Never throws: the change itself has already succeeded. */
export function refreshHomePage(): void {
  try {
    revalidatePath('/')
  } catch (error) {
    console.error('[Home] could not mark the home page for refreshing:', error instanceof Error ? error.message : 'unknown')
  }
}
