import * as Sentry from '@sentry/react'
import type { Breadcrumb, BrowserOptions, ErrorEvent, EventHint } from '@sentry/react'
import { ApiError } from '@/lib/api'

const withoutQuery = (url: string) => url.split('?')[0]!

/**
 * Drops what is not ours to report, and strips the rest to what diagnoses it.
 *
 * An ApiError is a response: a 4xx the screen already shows, or a 5xx the API
 * reported itself. The page URL loses its query string, where the ticket
 * filters put a search for a student's name or address.
 */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  if (hint?.originalException instanceof ApiError) return null

  if (event.request?.url) event.request = { url: withoutQuery(event.request.url) }
  delete event.user
  return event
}

/**
 * Console lines are left out, since a caught error can be logged with its
 * message; navigations and API calls keep their path without the query.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null

  const data = breadcrumb.data
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = withoutQuery(data[key])
    }
  }
  return breadcrumb
}

/**
 * Starts reporting to Sentry. Called only when VITE_SENTRY_DSN is set at
 * build time, so development, the tests and the e2e servers send nothing.
 */
export function initSentry(options: Pick<BrowserOptions, 'dsn' | 'environment' | 'transport'>) {
  Sentry.init({
    ...options,
    // SDK 11 collects these by default. Off, so a cookie, a header or a
    // request body never rides along with an error.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Errors only: no tracing and no session replay, which would record what
    // an agent sees on screen, ticket content included.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
}

/** Reports a fault of ours. A no-op until initSentry has run. */
export function reportError(error: unknown) {
  Sentry.captureException(error)
}
