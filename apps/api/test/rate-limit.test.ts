import { beforeEach, describe, expect, test } from 'bun:test'
import express from 'express'
import request from 'supertest'
import { createLoginRateLimit } from '../src/auth/rate-limit.ts'

/**
 * A stand-in for the login route, carrying a limiter that actually enforces.
 * The app's own limiter is skipped under NODE_ENV=test so the rest of the suite
 * can log in freely; this builds one deliberately enabled to test its config.
 */
function appWithLimiter() {
  const app = express()
  app.use(express.json())
  app.post('/api/auth/login', createLoginRateLimit(), (_req, res) => {
    res.status(401).json({ error: 'Invalid email or password' })
  })
  return app
}

let app: ReturnType<typeof appWithLimiter>

beforeEach(() => {
  app = appWithLimiter()
})

const attempt = (email: string) =>
  request(app).post('/api/auth/login').send({ email, password: 'wrong password' })

describe('login rate limit', () => {
  test('refuses further attempts once the budget is spent', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt('agent@example.com')).status).toBe(401)
    }

    const blocked = await attempt('agent@example.com')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many login attempts, please try again later' })
  })

  test('budgets each address separately, so one target cannot exhaust another', async () => {
    for (let i = 0; i < 11; i += 1) await attempt('first@example.com')

    // A colleague behind the same NAT must still be able to sign in.
    const other = await attempt('second@example.com')

    expect(other.status).toBe(401)
  })

  test('counts case-insensitively, so changing the casing buys no extra attempts', async () => {
    for (let i = 0; i < 10; i += 1) await attempt('agent@example.com')

    const shouted = await attempt('AGENT@EXAMPLE.COM')

    expect(shouted.status).toBe(429)
  })

  test('advertises the remaining budget', async () => {
    const res = await attempt('agent@example.com')

    expect(res.headers['ratelimit']).toContain('remaining=9')
  })
})
