import express, { type ErrorRequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import type { HealthResponse } from '@helpdesk/shared'
import { prisma } from './db.ts'
import { env } from './env.ts'
import { type SendEmail, sendEmail as resendSendEmail } from './email/outbound.ts'
import {
  type FetchReceivedEmail,
  fetchReceivedEmail as resendFetchReceivedEmail,
} from './email/receiving.ts'
import type { QueueProcessTicket } from './jobs/process-ticket.ts'
import { refuseForeignOrigin } from './auth/origin.ts'
import { authRouter } from './routes/auth.ts'
import { dashboardRouter } from './routes/dashboard.ts'
import { draftsRouter } from './routes/drafts.ts'
import { tasksRouter } from './routes/tasks.ts'
import { ticketsRouter } from './routes/tickets.ts'
import { usersRouter } from './routes/users.ts'
import { webhooksRouter } from './routes/webhooks.ts'

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

// Typed on Express.Locals, the open interface Express offers for app.locals. It
// types res.locals too, where nothing sets it; only req.app.locals is read.
declare global {
  namespace Express {
    interface Locals {
      sendEmail: SendEmail
      fetchReceivedEmail: FetchReceivedEmail
      queueProcessTicket: QueueProcessTicket
    }
  }
}

/** The Resend pair are replaced in tests, which must never reach Resend. */
type AppOptions = {
  sendEmail?: SendEmail
  fetchReceivedEmail?: FetchReceivedEmail
  /**
   * The job queue lives on a started pg-boss, which src/index.ts owns and
   * passes in. No default queue: left out, an inbound email fails with a 500,
   * and Resend redelivers it, rather than being saved with no job to answer it.
   */
  queueProcessTicket?: QueueProcessTicket
}

const noJobQueue: QueueProcessTicket = () => {
  throw new Error('No job queue: createApp was not given queueProcessTicket')
}

export function createApp({
  sendEmail = resendSendEmail,
  fetchReceivedEmail = resendFetchReceivedEmail,
  queueProcessTicket = noJobQueue,
}: AppOptions = {}) {
  const app = express()
  // On app.locals rather than imported by the routes, so a test can hand the
  // app a fake without mocking modules.
  app.locals.sendEmail = sendEmail
  app.locals.fetchReceivedEmail = fetchReceivedEmail
  app.locals.queueProcessTicket = queueProcessTicket

  // First, so every answer carries them: the webhook, a refused origin, a 404
  // and the error handler's included (#258). X-Powered-By named the framework,
  // and so which known flaws to try; nosniff makes a browser trust
  // Content-Type rather than guess. Two lines rather than helmet: the API
  // serves JSON only, so most of helmet's headers guard HTML it never sends.
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })

  // credentials: true is what lets the session cookie cross from app.<domain>
  // to api.<domain> in production. Without it the browser sends the cookie on
  // no cross-origin request, and refuses to expose the response of one that
  // tries. Locally the Vite proxy makes /api same-origin, so this only bites
  // when the frontend talks to the API directly.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }))
  // Before express.json(): a webhook's signature is checked against its raw
  // body, which the JSON parser would consume first. No session either: Resend
  // proves itself by the signature.
  app.use('/api/webhooks', webhooksRouter)
  // After the webhook, which Resend's servers call with no browser involved,
  // and before every route a signed-in page can reach (#249).
  app.use(refuseForeignOrigin)
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
  app.use('/api/users', usersRouter)
  app.use('/api/tickets', ticketsRouter)
  app.use('/api/drafts', draftsRouter)
  app.use('/api/dashboard', dashboardRouter)
  // No session: the scheduled workflow proves itself with TASKS_SECRET.
  app.use('/api/tasks', tasksRouter)

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
