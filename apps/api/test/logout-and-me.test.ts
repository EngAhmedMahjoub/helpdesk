import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { createSession } from '../src/auth/session.ts'
import { prisma, resetDatabase } from './db.ts'
import * as fixtures from './fixtures.ts'
import { TEST_PASSWORD, clearsSessionCookie, cookieHeader, sessionCookieFrom } from './fixtures.ts'

const app = createApp()
const password = TEST_PASSWORD

/** Named and hashed alike whatever the role: the round trip signs in and reads the name back. */
const createSignInUser = (overrides: fixtures.NewUser = {}) =>
  fixtures.createUser({ email: 'agent@example.com', name: 'Agent', password, ...overrides })

beforeEach(resetDatabase)

describe('POST /api/auth/logout', () => {
  test('deletes the session row', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)
    expect(await prisma.session.count()).toBe(1)

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(204)
    expect(await prisma.session.count()).toBe(0)
  })

  test('clears the cookie', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))

    expect(clearsSessionCookie(res)).toBe(true)
  })

  test('leaves the user account alone', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.isActive).toBe(true)
  })

  test('ends only the session that was used', async () => {
    const user = await createSignInUser()
    const phone = await createSession(user.id)
    const laptop = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(phone))

    // Signing out on one device must not sign the user out everywhere.
    const remaining = await prisma.session.findMany({ where: { userId: user.id } })
    expect(remaining).toHaveLength(1)
    expect(
      (await request(app).get('/api/auth/me').set('Cookie', cookieHeader(laptop))).status,
    ).toBe(200)
  })

  test('the token stops working afterwards', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(401)
  })

  test('succeeds with no cookie at all', async () => {
    const res = await request(app).post('/api/auth/logout')

    expect(res.status).toBe(204)
  })

  test('succeeds with an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader('a'.repeat(64)))

    expect(res.status).toBe(204)
  })

  test('is idempotent', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)

    const first = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))
    const second = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token))

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
  })

  test('does not touch sessions belonging to other users', async () => {
    const mine = await createSignInUser({ email: 'mine@example.com' })
    const theirs = await createSignInUser({ email: 'theirs@example.com' })
    const myToken = await createSession(mine.id)
    await createSession(theirs.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(myToken))

    expect(await prisma.session.count({ where: { userId: theirs.id } })).toBe(1)
  })
})

describe('GET /api/auth/me', () => {
  test('returns the current user', async () => {
    const user = await createSignInUser({ role: 'admin' })
    const token = await createSession(user.id)

    const res = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email, name: 'Agent', role: 'admin' })
  })

  test('returns nothing beyond id, email, name and role', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)

    const res = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(token))

    expect(Object.keys(res.body).sort()).toEqual(['email', 'id', 'name', 'role'])
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })

  test('returns 401 without a cookie', async () => {
    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  test('returns 401 for a deactivated user', async () => {
    const user = await createSignInUser()
    const token = await createSession(user.id)
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })

    const res = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(token))

    expect(res.status).toBe(401)
  })
})

describe('the login, me, logout round trip', () => {
  test('works end to end through the real app', async () => {
    const user = await createSignInUser({ role: 'admin' })

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password })
    const sessionCookie = sessionCookieFrom(login) ?? ''

    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie)
    const logout = await request(app).post('/api/auth/logout').set('Cookie', sessionCookie)
    const after = await request(app).get('/api/auth/me').set('Cookie', sessionCookie)

    expect(login.status).toBe(200)
    expect(me.body).toEqual({ id: user.id, email: user.email, name: 'Agent', role: 'admin' })
    expect(logout.status).toBe(204)
    expect(after.status).toBe(401)
    expect(await prisma.session.count()).toBe(0)
  })
})
