import type { MetadataRoute } from 'next'
import { APP_MANIFEST } from '@/lib/appManifest'

// /manifest.webmanifest: the installed app's name, colour and icons (src/lib/appManifest.ts)
export default function manifest(): MetadataRoute.Manifest {
  return APP_MANIFEST
}
