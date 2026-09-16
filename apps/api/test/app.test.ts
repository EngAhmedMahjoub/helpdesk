import { describe, expect, mock, test } from 'bun:test'
import request from 'supertest'

// env.ts validates process.env at import time; tests never reach a real database.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'

mock.module('../src/db.ts', () => ({
  prisma: { $queryRaw: () => Promise.resolve([{ result: 1 }]) },
}))

const { createApp } = await import('../src/app.ts')
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
