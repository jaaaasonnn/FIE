import { createClient } from '@supabase/supabase-js'
import { WebSocket } from 'ws'

// supabase-js always spins up a Realtime client internally, which needs a
// global WebSocket constructor that Node 20 doesn't provide. We only use
// Storage here, but the constructor still runs — polyfill rather than pull
// in a newer Node runtime just for this.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
}

// Server-only client — uses the service role key, which bypasses Row Level
// Security entirely. Never import this from client components; only from
// Route Handlers. Ownership checks happen in app code via getSessionUser(),
// not via Storage RLS (the app doesn't use Supabase Auth for identity).
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

export const AVATARS_BUCKET = 'avatars'
export const LISTING_PHOTOS_BUCKET = 'listing-photos'

// Unlike the two buckets above, this one is private — it holds real
// government ID scans and selfies, not content meant to be publicly
// browsable. Never call getPublicUrl() against it; generate a short-lived
// signed URL per read instead (see GET /api/admin/verifications).
export const VERIFICATION_DOCS_BUCKET = 'verification-docs'
