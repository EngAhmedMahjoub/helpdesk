import { beforeEach, describe, expect, test } from 'bun:test'
import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { requireAuth } from '../src/auth/middleware.ts'
import { createSession, hashToken } from '../src/auth/session.ts'
import { prisma, resetDatabase } from './db.ts'
import * as fixtures from './fixtures.ts'
import { clearsSessionCookie, cookieHeader } from './fixtures.ts'

// requireAuth guards no real route until 1.9, so it is mounted on a stub that
// echoes whatever the middleware attached to the request.
const app = express()
app.use(cookieParser())
app.get('/guarded', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

/** The middleware attaches the name, so the tests pin it. */
const createUser = (overrides: fixtures.NewUser = {}) =>
  fixtures.createUser({ name: 'Agent', ...overrides })

beforeEach(resetDatabase)

describe('requireAuth accepts a valid session', () => {
  test('attaches the user and calls the route', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({ id: user.id, email: user.email, name: 'Agent', role: 'agent' })
  })

  test('attaches no password hash', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('not-used-here')
  })

  test('leaves the session row in place', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(await prisma.session.count()).toBe(1)
  })
})

describe('requireAuth rejects a missing cookie', () => {
  test('returns 401 when no cookie is sent at all', async () => {
    const res = await request(app).get('/guarded')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  test('returns 401 when the session cookie is empty', async () => {
    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(''))

    expect(res.status).toBe(401)
  })

  test('returns 401 when some other cookie is sent', async () => {
    const res = await request(app).get('/guarded').set('Cookie', 'unrelated=value')

    expect(res.status).toBe(401)
  })
})

describe('requireAuth rejects an unknown token', () => {
  test('returns 401 and clears the stale cookie', async () => {
    const res = await request(app)
      .get('/guarded')
      .set('Cookie', cookieHeader('a'.repeat(64)))

    expect(res.status).toBe(401)
    expect(clearsSessionCookie(res)).toBe(true)
  })

  test('rejects the stored hash presented as though it were the token', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    const { tokenHash } = await prisma.session.findFirstOrThrow({ where: { userId: user.id } })

    // Someone reading the database must not be able to authenticate with what
    // they find there.
    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(tokenHash))

    expect(tokenHash).toBe(hashToken(token))
    expect(res.status).toBe(401)
  })
})

describe('requireAuth rejects an expired session', () => {
  test('returns 401 and clears the cookie', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(401)
    expect(clearsSessionCookie(res)).toBe(true)
  })

  test('deletes the expired row rather than leaving it to be replayed', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(await prisma.session.count()).toBe(0)
  })

  test('accepts a session expiring one second from now', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() + 1000) },
    })

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(200)
  })
})

describe('requireAuth rejects a deactivated user', () => {
  test('returns 401 for a session that was valid before deactivation', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    // Session still live; only the user was switched off, as 2.3 will do.
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(401)
    expect(clearsSessionCookie(res)).toBe(true)
  })

  test('accepts the same session again once the user is reactivated', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    await request(app).get('/guarded').set('Cookie', cookieHeader(token))
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } })

    const res = await request(app).get('/guarded').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(200)
  })
})

describe('requireAuth gives the same answer for every rejection', () => {
  test('missing, unknown, expired, and inactive are indistinguishable', async () => {
    const missing = await request(app).get('/guarded')
    const unknown = await request(app)
      .get('/guarded')
      .set('Cookie', cookieHeader('b'.repeat(64)))

    const expiredUser = await createUser()
    const expiredToken = await createSession(expiredUser.id)
    await prisma.session.updateMany({
      where: { userId: expiredUser.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const expired = await request(app).get('/guarded').set('Cookie', cookieHeader(expiredToken))

    await prisma.user.update({ where: { id: expiredUser.id }, data: { isActive: false } })
    const inactiveToken = await createSession(expiredUser.id)
    const inactive = await request(app).get('/guarded').set('Cookie', cookieHeader(inactiveToken))

    for (const res of [unknown, expired, inactive]) {
      expect(res.status).toBe(missing.status)
      expect(res.body).toEqual(missing.body)
    }
  })
})
