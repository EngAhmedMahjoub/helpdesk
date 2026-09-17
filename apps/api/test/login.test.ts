import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'
import { SESSION_COOKIE, SESSION_TTL_MS, hashToken } from '../src/auth/session.ts'
import { prisma, resetDatabase } from './db.ts'

const app = createApp()
const password = 'a-long-enough-password'

async function createUser(overrides: { email?: string; isActive?: boolean } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? 'agent@example.com',
      name: 'Agent',
      passwordHash: await hashPassword(password),
      isActive: overrides.isActive ?? true,
    },
  })
}

/** Pulls the session cookie's value out of a Set-Cookie header. */
function sessionCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as string[] | undefined
  return header?.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
}

beforeEach(resetDatabase)

describe('POST /api/auth/login with the correct password', () => {
  test('returns 200 and the user', async () => {
    const user = await createUser()

    const res = await request(app).post('/api/auth/login').send({ email: user.email, password })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email, name: 'Agent', role: 'agent' })
    // The password must never come back out, hashed or otherwise.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })

  test('sets a hardened session cookie', async () => {
    const user = await createUser()

    const res = await request(app).post('/api/auth/login').send({ email: user.email, password })
    const cookie = sessionCookie(res)

    expect(cookie).toBeDefined()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`)
    // Secure is off outside production so local HTTP development works.
    expect(cookie).not.toContain('Secure')
  })

  test('stores only the hash of the token that went into the cookie', async () => {
    const user = await createUser()

    const res = await request(app).post('/api/auth/login').send({ email: user.email, password })
    const token = sessionCookie(res)?.split(';')[0]?.split('=')[1] ?? ''

    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } })
    expect(token).toHaveLength(64)
    expect(session.tokenHash).toBe(hashToken(token))
    // The raw token must not be recoverable from the row.
    expect(session.tokenHash).not.toBe(token)
  })

  test('expires the session eight hours out', async () => {
    const user = await createUser()

    await request(app).post('/api/auth/login').send({ email: user.email, password })

    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } })
    const ttl = session.expiresAt.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000)
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_MS)
  })

  test('accepts the email in any case', async () => {
    await createUser({ email: 'agent@example.com' })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Agent@Example.com', password })

    expect(res.status).toBe(200)
  })

  test('issues a distinct session for each login', async () => {
    const user = await createUser()

    const first = await request(app).post('/api/auth/login').send({ email: user.email, password })
    const second = await request(app).post('/api/auth/login').send({ email: user.email, password })

    expect(sessionCookie(first)).not.toBe(sessionCookie(second))
    expect(await prisma.session.count()).toBe(2)
  })
})

describe('POST /api/auth/login with bad credentials', () => {
  test('returns 401 for a wrong password and sets no cookie', async () => {
    const user = await createUser()

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong password' })

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Invalid email or password' })
    expect(sessionCookie(res)).toBeUndefined()
    expect(await prisma.session.count()).toBe(0)
  })

  test('returns 401 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password })

    expect(res.status).toBe(401)
    expect(sessionCookie(res)).toBeUndefined()
  })

  test('returns 401 for a deactivated user', async () => {
    const user = await createUser({ isActive: false })

    const res = await request(app).post('/api/auth/login').send({ email: user.email, password })

    expect(res.status).toBe(401)
    expect(sessionCookie(res)).toBeUndefined()
    expect(await prisma.session.count()).toBe(0)
  })

  test('answers identically whether the account exists or not', async () => {
    const user = await createUser()

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong password' })
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password })
    const deactivated = await createUser({ email: 'off@example.com', isActive: false })
    const inactive = await request(app)
      .post('/api/auth/login')
      .send({ email: deactivated.email, password })

    // Differing responses would let anyone enumerate registered addresses.
    expect(unknownEmail.status).toBe(wrongPassword.status)
    expect(unknownEmail.body).toEqual(wrongPassword.body)
    expect(inactive.status).toBe(wrongPassword.status)
    expect(inactive.body).toEqual(wrongPassword.body)
  })
})

describe('POST /api/auth/login with an invalid body', () => {
  test.each([
    ['a malformed email', { email: 'not-an-email', password }],
    ['an empty password', { email: 'agent@example.com', password: '' }],
    ['a missing password', { email: 'agent@example.com' }],
    ['no fields at all', {}],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app).post('/api/auth/login').send(body)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid request body' })
  })
})
