import {
  BrowserClient, SDK_VERSION, addEventProcessor, breadcrumbsIntegration, browserApiErrorsIntegration,
  browserSessionIntegration, dedupeIntegration, defaultStackParser, functionToStringIntegration, getCurrentScope,
  globalHandlersIntegration, httpContextIntegration, inboundFiltersIntegration, linkedErrorsIntegration,
  makeFetchTransport, rewriteFramesIntegration,
} from '@sentry/nextjs'
import { SCRUBBING } from '@/lib/sentryScrub'

// Loaded automatically by Next.js on the client — no import needed
// elsewhere. Covers real users hitting broken UI, not just API/cron
// failures. No session replay or feedback widget yet — minimal error
// capture only, per the scoped plan.
//
// Error reporting only (G5). `Sentry.init` from @sentry/nextjs always brings
// the browser tracing code (about 40 KB on every page) although tracing is
// off, and Sentry's switch to leave it out is not applied under Turbopack.
// So the client is put together here from the same parts, minus tracing:
// errors thrown in a page, promise rejections nobody handles, errors inside
// timers and event handlers, their causes, the breadcrumbs that led to them,
// and release health. The server and edge set-ups are unchanged.
const client = new BrowserClient({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // As @sentry/nextjs sets them, so reports match the uploaded source maps and the right deploy
  release: process.env._sentryRelease,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ? `vercel-${process.env.NEXT_PUBLIC_VERCEL_ENV}` : process.env.NODE_ENV,
  transport: makeFetchTransport,
  stackParser: defaultStackParser,
  integrations: [
    inboundFiltersIntegration(),
    functionToStringIntegration(),
    browserApiErrorsIntegration(),
    breadcrumbsIntegration(),
    globalHandlersIntegration(),
    linkedErrorsIntegration(),
    dedupeIntegration(),
    httpContextIntegration(),
    browserSessionIntegration(),
    // `<origin>/_next/static/...` becomes `app:///_next/static/...`, as @sentry/nextjs does, which is where
    // the source maps are uploaded to; Next's own chunks are not the app's code
    rewriteFramesIntegration({
      iteratee: (frame) => {
        try {
          frame.filename = frame.filename?.replace(new URL(frame.filename).origin, 'app://')
        } catch { /* not a URL: left as it is */ }
        if (frame.filename?.startsWith('app:///_next')) frame.filename = decodeURI(frame.filename)
        if (/\/_next\/static\/chunks\/(main-|main-app-|polyfills-|webpack-|framework-|framework\.)[0-9a-f]+\.js(:\d+)*$/.test(frame.filename ?? '')) frame.in_app = false
        return frame
      },
    }),
  ],
  _metadata: { sdk: { name: 'sentry.javascript.nextjs', version: SDK_VERSION, packages: [{ name: 'npm:@sentry/nextjs', version: SDK_VERSION }] } },
  // Emails, phone numbers, cookies and single-use links are taken out of
  // every report before it is sent (lib/sentryScrub.ts)
  ...SCRUBBING,
})
getCurrentScope().setClient(client)
client.init()

// Next.js navigates by throwing NEXT_REDIRECT: not an error (as @sentry/nextjs filters it)
addEventProcessor((event, hint) => {
  const thrown = hint?.originalException as { digest?: unknown } | undefined
  const redirect = (typeof thrown?.digest === 'string' && thrown.digest.startsWith('NEXT_REDIRECT;')) || event.exception?.values?.[0]?.value === 'NEXT_REDIRECT'
  return redirect ? null : event
})
