import express, { type ErrorRequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import type { HealthResponse } from '@helpdesk/shared'
import { prisma } from './db.ts'
import { env } from './env.ts'
import { authRouter } from './routes/auth.ts'

/**
 * The status a malformed request deserves, or undefined when the error is ours.
 *
 * Body-parser errors carry their own status — 400 for unparseable JSON, 413 for
 * a body over the 100KB default. Answering 500 for those blamed the server for
 * the client's mistake and let anyone fill the log with fake faults.
 */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined

  const status: unknown = 'status' in err ? err.status : undefined
  const statusCode: unknown = 'statusCode' in err ? err.statusCode : undefined
  const candidate = typeof status === 'number' ? status : statusCode

  return typeof candidate === 'number' && candidate >= 400 && candidate < 500
    ? candidate
    : undefined
}

/** The error's type alone — never its message or body, which echo the request. */
function describe(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string') {
    return err.type
  }
  return 'unknown'
}

export function createApp() {
  const app = express()

  // credentials: true is what lets the session cookie cross from app.<domain>
  // to api.<domain> in production. Without it the browser sends the cookie on
  // no cross-origin request, and refuses to expose the response of one that
  // tries. Locally the Vite proxy makes /api same-origin, so this only bites
  // when the frontend talks to the API directly.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }))
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', async (_req, res) => {
    let database: HealthResponse['database'] = 'up'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      console.error('Database health check failed:', err)
      database = 'down'
    }

    const body: HealthResponse = {
      status: database === 'up' ? 'ok' : 'error',
      database,
      timestamp: new Date().toISOString(),
    }
    res.status(database === 'up' ? 200 : 503).json(body)
  })

  app.use('/api/auth', authRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = clientErrorStatus(err)

    if (status) {
      // Never log the error object itself here. express.json() attaches the
      // raw body to a parse failure, so a login POST cut short by a flaky
      // client or a proxy would put a cleartext password in the log — and on a
      // hosted platform, in the log aggregator. The type and status are all
      // that is diagnostic anyway.
      console.warn(`Rejected a ${String(status)} request: ${describe(err)}`)
      res.status(status).json({ error: status === 413 ? 'Payload Too Large' : 'Bad Request' })
      return
    }

    console.error(err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
  app.use(errorHandler)

  return app
}
