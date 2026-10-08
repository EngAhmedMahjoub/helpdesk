import * as Sentry from '@sentry/bun'
import type { BunOptions, ErrorEvent, EventHint } from '@sentry/bun'

// Left out of the defaults:
// - The framework integrations report a route's error on their own when they
//   can patch the framework. Whether that works for Express under Bun's ES
//   modules is not something to rely on, and when it does the 500 would arrive
//   twice; the error handler in app.ts reports instead, the one place that
//   knows a 4xx from a fault of ours.
// - Console turns every console line into a breadcrumb on the next event, and
//   app.ts logs a 500's whole error, Prisma's argument-quoting message
//   included. Those lines stay in Render's log.
const LEFT_OUT = new Set(['Express', 'Fastify', 'Hapi', 'Hono', 'Koa', 'Console'])

// A Prisma error's message quotes the query's arguments (#239): a ticket's
// reply, a summary, a student's address. The type and code say which failure
// it was, and the stack says where.
const QUOTES_ITS_ARGUMENTS = /^PrismaClient/

/**
 * Strips an event to what diagnoses a fault and nothing a person wrote.
 *
 * The request keeps its method and path only. Its body is out because a login
 * that failed to parse carries a cleartext password, the reason app.ts never
 * logs one; cookies and headers because the session cookie and the webhook's
 * signature are among them; the query string because nothing diagnostic is in
 * it and a token might be.
 */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  if (event.request) {
    const { method, url } = event.request
    event.request = { method, url: url?.split('?')[0] }
  }
  delete event.user

  for (const exception of event.exception?.values ?? []) {
    if (exception.type && QUOTES_ITS_ARGUMENTS.test(exception.type)) {
      exception.value = '[redacted: Prisma messages quote the query arguments]'
    }
  }

  const original = hint?.originalException
  if (original instanceof Error && 'code' in original && typeof original.code === 'string') {
    event.tags = { ...event.tags, code: original.code }
  }
  return event
}

/**
 * Starts reporting to Sentry. Called only when SENTRY_DSN is set, so
 * development, the tests and the e2e servers send nothing.
 */
export function initSentry(
  options: Pick<BunOptions, 'dsn' | 'environment' | 'release' | 'transport'>,
) {
  Sentry.init({
    ...options,
    // SDK 11 collects all of this by default. Off, every field, rather than
    // trusting scrubEvent alone: local variables would hold a student's email
    // or a password, and bodies are the reason app.ts never logs one.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // Errors only. No tracesSampleRate, not even 0: any value loads the tracing
    // integrations — Prisma, Postgres, Anthropic — whose spans would be
    // recorded on a 0.1 vCPU instance only to be thrown away.
    integrations: (defaults) => defaults.filter((i) => !LEFT_OUT.has(i.name)),
    beforeSend: scrubEvent,
  })
}

/**
 * Reports a fault of ours. A no-op until initSentry has run. The context is
 * attached as tags, so it must hold identifiers, never content.
 */
export function reportError(error: unknown, context?: Record<string, string | number>) {
  Sentry.captureException(error, context ? { tags: context } : undefined)
}
