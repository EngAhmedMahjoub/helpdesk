import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { Role } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'
import { SESSION_COOKIE, createSession } from '../src/auth/session.ts'
import { prisma, resetDatabase } from './db.ts'

const app = createApp()
const password = 'a-long-enough-password'

async function createUser(overrides: { role?: Role; email?: string } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? 'agent@example.com',
      name: 'Agent',
      passwordHash: await hashPassword(password),
      role: overrides.role ?? 'agent',
    },
  })
}

const cookie = (token: string) => `${SESSION_COOKIE}=${token}`

/** True when the response tells the browser to drop the session cookie. */
function clearsCookie(res: request.Response): boolean {
  const header = (res.headers['set-cookie'] as string[] | undefined) ?? []
  return header.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))
}

beforeEach(resetDatabase)

describe('POST /api/auth/logout', () => {
  test('deletes the session row', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    expect(await prisma.session.count()).toBe(1)

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie(token))

    expect(res.status).toBe(204)
    expect(await prisma.session.count()).toBe(0)
  })

  test('clears the cookie', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie(token))

    expect(clearsCookie(res)).toBe(true)
  })

  test('leaves the user account alone', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookie(token))

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.isActive).toBe(true)
  })

  test('ends only the session that was used', async () => {
    const user = await createUser()
    const phone = await createSession(user.id)
    const laptop = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookie(phone))

    // Signing out on one device must not sign the user out everywhere.
    const remaining = await prisma.session.findMany({ where: { userId: user.id } })
    expect(remaining).toHaveLength(1)
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(laptop))).status).toBe(200)
  })

  test('the token stops working afterwards', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookie(token))
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token))

    expect(res.status).toBe(401)
  })

  test('succeeds with no cookie at all', async () => {
    const res = await request(app).post('/api/auth/logout')

    expect(res.status).toBe(204)
  })

  test('succeeds with an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie('a'.repeat(64)))

    expect(res.status).toBe(204)
  })

  test('is idempotent', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    const first = await request(app).post('/api/auth/logout').set('Cookie', cookie(token))
    const second = await request(app).post('/api/auth/logout').set('Cookie', cookie(token))

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
  })

  test('does not touch sessions belonging to other users', async () => {
    const mine = await createUser({ email: 'mine@example.com' })
    const theirs = await createUser({ email: 'theirs@example.com' })
    const myToken = await createSession(mine.id)
    await createSession(theirs.id)

    await request(app).post('/api/auth/logout').set('Cookie', cookie(myToken))

    expect(await prisma.session.count({ where: { userId: theirs.id } })).toBe(1)
  })
})

describe('GET /api/auth/me', () => {
  test('returns the current user', async () => {
    const user = await createUser({ role: 'admin' })
    const token = await createSession(user.id)

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email, name: 'Agent', role: 'admin' })
  })

  test('returns nothing beyond id, email, name and role', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token))

    expect(Object.keys(res.body).sort()).toEqual(['email', 'id', 'name', 'role'])
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })

  test('returns 401 without a cookie', async () => {
    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  test('returns 401 for a deactivated user', async () => {
    const user = await createUser()
    const token = await createSession(user.id)
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token))

    expect(res.status).toBe(401)
  })
})

describe('the login, me, logout round trip', () => {
  test('works end to end through the real app', async () => {
    const user = await createUser({ role: 'admin' })

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password })
    // Supertest types headers as strings, but set-cookie really is an array.
    const sessionCookie = ((login.headers['set-cookie'] as string[] | undefined) ?? [])[0] ?? ''

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
