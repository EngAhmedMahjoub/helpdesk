import express, { type ErrorRequestHandler } from 'express'
import type { HealthResponse } from '@helpdesk/shared'

export function createApp() {
  const app = express()

  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', timestamp: new Date().toISOString() }
    res.json(body)
  })

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
