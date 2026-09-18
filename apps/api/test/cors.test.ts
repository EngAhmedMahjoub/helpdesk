import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { env } from '../src/env.ts'
import { resetDatabase } from './db.ts'
import { TEST_PASSWORD, createUser, sessionCookieFor } from './fixtures.ts'

const app = createApp()
const allowed = env.WEB_ORIGIN
const foreign = 'http://evil.example'

beforeEach(resetDatabase)

async function signIn() {
  const user = await createUser()
  return sessionCookieFor(user.id)
}

describe('preflight from the allowed origin', () => {
  test('is allowed and permits credentials', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'POST')

    expect(res.status).toBeLessThan(300)
    expect(res.headers['access-control-allow-origin']).toBe(allowed)
    // Without this the browser discards the Set-Cookie on the real request.
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  test('permits the Content-Type header login sends', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')

    expect(res.headers['access-control-allow-headers']).toContain('content-type')
  })
})

describe('requests from the allowed origin', () => {
  test('login is allowed to expose its response and set a cookie', async () => {
    const user = await createUser({ password: TEST_PASSWORD })

    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', allowed)
      .send({ email: user.email, password: TEST_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(allowed)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['set-cookie']).toBeDefined()
  })

  test('me is allowed to expose its response', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', allowed)
      .set('Cookie', await signIn())

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(allowed)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })
})

describe('requests from any other origin', () => {
  test('are never told they are allowed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', foreign)
      .set('Cookie', await signIn())

    // The header carries the configured origin, never the caller's, so the
    // browser blocks the response. An echoed origin would defeat the whole
    // point of allowing credentials.
    expect(res.headers['access-control-allow-origin']).not.toBe(foreign)
    expect(res.headers['access-control-allow-origin']).toBe(allowed)
  })

  test('are refused at preflight too', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', foreign)
      .set('Access-Control-Request-Method', 'POST')

    expect(res.headers['access-control-allow-origin']).not.toBe(foreign)
  })

  test('cannot be allowed by a look-alike origin', async () => {
    for (const lookAlike of [`${allowed}.evil.example`, `${allowed}:1`, 'http://localhost:5174']) {
      const res = await request(app).get('/api/auth/me').set('Origin', lookAlike)

      expect(res.headers['access-control-allow-origin']).not.toBe(lookAlike)
    }
  })
})

describe('the allowed origin', () => {
  test('is configuration, not a hardcoded localhost', () => {
    // Production sets this to https://app.<domain>; the default only covers
    // local development.
    expect(env.WEB_ORIGIN).toBe(process.env.WEB_ORIGIN ?? 'http://localhost:5173')
  })

  test('varies the response on Origin so caches cannot cross-serve it', async () => {
    const res = await request(app).get('/api/health').set('Origin', allowed)

    expect(res.headers['vary']).toContain('Origin')
  })
})
