import type { MetadataRoute } from 'next'

// The installed app (app shell stage 4): what a phone is told when FieGH is added to its home screen. Served as
// /manifest.webmanifest by src/app/manifest.ts, which Next links from every page. Public and the same for everyone:
// nothing about a person goes in it. The colour is the phone header's and Explore's (--color-bg in globals.css); it
// is given here only, never as a theme-color tag, so the browser looks as it did. Icons: scripts/app-icons.mjs.

export const APP_NAME = 'FieGH'
export const APP_COLOUR = '#FAF7F2'
export const APP_DESCRIPTION = 'Short stays, monthly lets, and long-term leases, with Ghanaian roots and warm hospitality. Find your perfect home or start hosting on FieGH.'

export const APP_MANIFEST: MetadataRoute.Manifest = {
  id: '/',
  name: APP_NAME,
  short_name: APP_NAME,
  description: APP_DESCRIPTION,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: APP_COLOUR,
  theme_color: APP_COLOUR,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
