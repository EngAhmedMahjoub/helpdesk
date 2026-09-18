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
