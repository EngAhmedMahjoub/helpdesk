import express, { type ErrorRequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import type { HealthResponse } from '@helpdesk/shared'
import { prisma } from './db.ts'
import { authRouter } from './routes/auth.ts'

export function createApp() {
  const app = express()

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
    console.error(err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
  app.use(errorHandler)

  return app
}
