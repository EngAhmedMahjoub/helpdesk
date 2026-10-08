import { env } from './env.ts'
import { initSentry } from './sentry.ts'

// Imported first by index.ts, so Sentry's handlers for uncaught errors and
// unhandled rejections are in place before the knowledge base and the job
// queue start.
if (env.SENTRY_DSN) {
  initSentry({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, release: env.SENTRY_RELEASE })
}
