import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { Role, UserSummary } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { SESSION_COOKIE, createSession } from '../src/auth/session.ts'
import { prisma, resetDatabase } from './db.ts'

const app = createApp()

async function createUser(
  overrides: { email?: string; name?: string; role?: Role; isActive?: boolean } = {},
) {
  const role = overrides.role ?? 'agent'
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role}@example.com`,
      name: overrides.name ?? role,
      // The list never verifies a password, so a real hash would only slow the
      // suite down by ~100ms per user.
      passwordHash: 'not-used-here',
      role,
      isActive: overrides.isActive ?? true,
    },
  })
}

async function cookieFor(userId: string) {
  return `${SESSION_COOKIE}=${await createSession(userId)}`
}

beforeEach(resetDatabase)

describe('GET /api/users as an admin', () => {
  test('returns every user, oldest first', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser({ email: 'agent@example.com', name: 'Agent' })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await cookieFor(admin.id))

    expect(res.status).toBe(200)
    const body = res.body as UserSummary[]
    expect(body.map((u) => u.email)).toEqual(['admin@example.com', 'agent@example.com'])
    expect(body[1]).toEqual({
      id: agent.id,
      email: 'agent@example.com',
      name: 'Agent',
      role: 'agent',
      isActive: true,
      createdAt: agent.createdAt.toISOString(),
    })
  })

  test('never exposes the password hash', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: 'a-recognisable-secret' },
    })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await cookieFor(admin.id))

    expect(res.text).not.toContain('a-recognisable-secret')
    expect(res.text).not.toContain('passwordHash')
  })

  test('includes deactivated users, flagged as inactive', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    await createUser({ email: 'gone@example.com', isActive: false })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await cookieFor(admin.id))

    const body = res.body as UserSummary[]
    expect(body).toHaveLength(2)
    expect(body.find((u) => u.email === 'gone@example.com')?.isActive).toBe(false)
  })

  test('returns just the caller when no one else exists', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await cookieFor(admin.id))

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})

describe('GET /api/users without admin rights', () => {
  test('gives an agent 403 and no user data', async () => {
    const agent = await createUser()
    await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await cookieFor(agent.id))

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
    expect(res.text).not.toContain('admin@example.com')
  })

  test('gives an unauthenticated caller 401', async () => {
    await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app).get('/api/users')

    expect(res.status).toBe(401)
    expect(res.text).not.toContain('admin@example.com')
  })

  test('gives a deactivated admin 401', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const cookie = await cookieFor(admin.id)
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } })

    const res = await request(app).get('/api/users').set('Cookie', cookie)

    expect(res.status).toBe(401)
  })
})

describe('POST /api/users as an admin', () => {
  const body = {
    email: 'new.agent@example.com',
    name: 'New Agent',
    password: 'a-long-enough-password',
  }

  test('creates an agent and returns it without the password', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(admin.id))
      .send(body)

    expect(res.status).toBe(201)
    const created = res.body as UserSummary
    expect(created).toMatchObject({
      email: 'new.agent@example.com',
      name: 'New Agent',
      role: 'agent',
      isActive: true,
    })
    expect(res.text).not.toContain('passwordHash')
    expect(res.text).not.toContain(body.password)
  })

  test('stores a hash the new agent can log in with', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const cookie = await cookieFor(admin.id)

    await request(app).post('/api/users').set('Cookie', cookie).send(body)

    // The initial password is only useful if it actually signs the agent in —
    // the one check that proves the hash was written, not just some string.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: body.password })

    expect(login.status).toBe(200)
    expect(login.body.role).toBe('agent')
  })

  test('lowercases the address, so the agent can log in as they typed it', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(admin.id))
      .send({ ...body, email: 'Mixed.Case@Example.COM' })

    expect(res.status).toBe(201)
    expect((res.body as UserSummary).email).toBe('mixed.case@example.com')
    expect(
      await prisma.user.findUnique({ where: { email: 'mixed.case@example.com' } }),
    ).not.toBeNull()
  })

  test('ignores a role in the body rather than minting an admin', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(admin.id))
      .send({ ...body, role: 'admin', isActive: false })

    expect(res.status).toBe(201)
    expect(res.body as UserSummary).toMatchObject({ role: 'agent', isActive: true })
  })
})

describe('POST /api/users with a duplicate email', () => {
  const body = { email: 'taken@example.com', name: 'Second', password: 'a-long-enough-password' }

  test('rejects an address that already exists', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    await createUser({ email: 'taken@example.com' })

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(admin.id))
      .send(body)

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A user with that email already exists' })
    expect(await prisma.user.count({ where: { email: 'taken@example.com' } })).toBe(1)
  })

  test('rejects the same address in a different case', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    await createUser({ email: 'taken@example.com' })

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(admin.id))
      .send({ ...body, email: 'TAKEN@example.com' })

    // Lowercasing before the insert is what makes the unique index catch this;
    // stored as typed, it would be a second account nobody could log in to.
    expect(res.status).toBe(409)
  })
})

describe('POST /api/users with an invalid body', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['an empty body', {}],
    ['a malformed email', { email: 'not-an-email', name: 'A', password: 'a-long-enough-password' }],
    ['a blank name', { email: 'a@example.com', name: '   ', password: 'a-long-enough-password' }],
    ['a password under 12 characters', { email: 'a@example.com', name: 'A', password: 'short' }],
    ['a missing password', { email: 'a@example.com', name: 'A' }],
  ]

  for (const [label, payload] of cases) {
    test(`rejects ${label} and creates nobody`, async () => {
      const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

      const res = await request(app)
        .post('/api/users')
        .set('Cookie', await cookieFor(admin.id))
        .send(payload)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid request body' })
      expect(await prisma.user.count()).toBe(1)
    })
  }
})

describe('POST /api/users without admin rights', () => {
  const body = {
    email: 'new.agent@example.com',
    name: 'New Agent',
    password: 'a-long-enough-password',
  }

  test('gives an agent 403 and creates nobody', async () => {
    const agent = await createUser()

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', await cookieFor(agent.id))
      .send(body)

    expect(res.status).toBe(403)
    expect(await prisma.user.count()).toBe(1)
  })

  test('gives an unauthenticated caller 401 and creates nobody', async () => {
    const res = await request(app).post('/api/users').send(body)

    expect(res.status).toBe(401)
    expect(await prisma.user.count()).toBe(0)
  })
})
