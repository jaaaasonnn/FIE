import { headers } from 'next/headers'
import { NextRequest } from 'next/server'

// G5: a page that needs one person's data gets it with the page instead of fetching it from the browser
// afterwards (on a slow phone line that is the JavaScript, then the session check, then the data, one after
// another). The page calls the API route's own GET function here, in the same process, for the request
// that is being answered: the route reads the session from that request's cookie (getSessionUser), so
// the data is exactly what the browser would get, through the same checks and privacy rules.
//
// It never decides anything. Only a 200 is passed on; anything else (signed out, not allowed, not found,
// an error, no answer within the time limit) gives null, and the page then fetches in the browser as it
// always did, with its tries, "Try again" and its own handling of a 401 (G1, G6).

/**
 * How long a page waits for its data before leaving it to the browser. The page is sent once its reads
 * are done, not streamed around them: a streamed part still on its way when the session check or the
 * exchange rate updates the page above it is redrawn by React in the browser, and the copy the server sent
 * afterwards is left behind, hidden, in the page (a second set of the same inputs).
 */
export const SERVER_READ_TIMEOUT_MS = 3000

export async function serverRead<T>(path: string, GET: (req: NextRequest) => Promise<Response>, timeoutMs = SERVER_READ_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const req = new NextRequest(new URL(path, 'http://localhost'), { headers: new Headers(await headers()) })
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })
    const res = await Promise.race([GET(req), late])
    if (!res || res.status !== 200) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
