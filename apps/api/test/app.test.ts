import { describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'

// Runs against the real test database (see .env.test), so the health check
// exercises an actual query rather than a stubbed one.
const app = createApp()

describe('GET /api/health', () => {
  test('reports the API and database as up', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database).toBe('up')
  })
})

describe('unknown /api routes', () => {
  test('return a 404 JSON body', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not Found' })
  })
})
