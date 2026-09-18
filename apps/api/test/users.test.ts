import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { UserSummary } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { prisma, resetDatabase } from './db.ts'
import { createUser, sessionCookieFor } from './fixtures.ts'

const app = createApp()

beforeEach(resetDatabase)

describe('GET /api/users as an admin', () => {
  test('returns every user, oldest first', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser({ email: 'agent@example.com', name: 'Agent' })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await sessionCookieFor(admin.id))

    expect(res.status).toBe(200)
    const body = res.body as UserSummary[]
    expect(body.map((u) => u.email)).toEqual(['admin@example.com', 'agent@example.com'])
    expect(body[1]).toEqual({
      id: agent.id,
      email: 'agent@example.com',
      name: 'Agent',
      role: 'agent',
      isActive: true,
      isProtected: false,
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
      .set('Cookie', await sessionCookieFor(admin.id))

    expect(res.text).not.toContain('a-recognisable-secret')
    expect(res.text).not.toContain('passwordHash')
  })

  test('includes deactivated users, flagged as inactive', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    await createUser({ email: 'gone@example.com', isActive: false })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await sessionCookieFor(admin.id))

    const body = res.body as UserSummary[]
    expect(body).toHaveLength(2)
    expect(body.find((u) => u.email === 'gone@example.com')?.isActive).toBe(false)
  })

  test('returns just the caller when no one else exists', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await sessionCookieFor(admin.id))

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
      .set('Cookie', await sessionCookieFor(agent.id))

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
    const cookie = await sessionCookieFor(admin.id)
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
      .set('Cookie', await sessionCookieFor(admin.id))
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
    const cookie = await sessionCookieFor(admin.id)

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
      .set('Cookie', await sessionCookieFor(admin.id))
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
      .set('Cookie', await sessionCookieFor(admin.id))
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
      .set('Cookie', await sessionCookieFor(admin.id))
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
      .set('Cookie', await sessionCookieFor(admin.id))
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
    [
      'a name over 100 characters',
      { email: 'a@example.com', name: 'a'.repeat(101), password: 'a-long-enough-password' },
    ],
    ['a password under 12 characters', { email: 'a@example.com', name: 'A', password: 'short' }],
    [
      'a password over 200 characters',
      { email: 'a@example.com', name: 'A', password: 'a'.repeat(201) },
    ],
    ['a missing password', { email: 'a@example.com', name: 'A' }],
    [
      'an email over 254 characters',
      { email: `${'a'.repeat(243)}@example.com`, name: 'A', password: 'a-long-enough-password' },
    ],
    [
      // Random, so Postgres cannot compress it under the unique index's 2704-byte
      // row limit. Before the cap this was a 500, after argon2 had already run.
      'an email too long for the unique index',
      {
        email: `${randomBytes(1500).toString('hex')}@example.com`,
        name: 'A',
        password: 'a-long-enough-password',
      },
    ],
  ]

  for (const [label, payload] of cases) {
    test(`rejects ${label} and creates nobody`, async () => {
      const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

      const res = await request(app)
        .post('/api/users')
        .set('Cookie', await sessionCookieFor(admin.id))
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
      .set('Cookie', await sessionCookieFor(agent.id))
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

describe('PATCH /api/users/:id deactivating an agent', () => {
  test("the agent's next request returns 401", async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    const agentCookie = await sessionCookieFor(agent.id)

    // The session works right up to the moment it is revoked.
    expect((await request(app).get('/api/auth/me').set('Cookie', agentCookie)).status).toBe(200)

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).isActive).toBe(false)

    const after = await request(app).get('/api/auth/me').set('Cookie', agentCookie)
    expect(after.status).toBe(401)
  })

  test("deletes the agent's sessions, and only theirs", async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    const other = await createUser({ email: 'other@example.com' })
    await sessionCookieFor(agent.id)
    await sessionCookieFor(agent.id)
    await sessionCookieFor(other.id)

    await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    expect(await prisma.session.count({ where: { userId: agent.id } })).toBe(0)
    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1)
  })

  test('refuses a fresh login while deactivated', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const password = 'a-long-enough-password'
    const created = await request(app)
      .post('/api/users')
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ email: 'agent@example.com', name: 'Agent', password })

    await request(app)
      .patch(`/api/users/${(created.body as UserSummary).id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    // Revoking sessions is only half of it: the password must stop working too.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'agent@example.com', password })
    expect(login.status).toBe(401)
  })
})

describe('PATCH /api/users/:id reactivating an agent', () => {
  test('lets the agent log in again, but does not restore old sessions', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const adminCookie = await sessionCookieFor(admin.id)
    const password = 'a-long-enough-password'
    const created = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ email: 'agent@example.com', name: 'Agent', password })
    const agentId = (created.body as UserSummary).id

    const oldCookie = await sessionCookieFor(agentId)
    await request(app)
      .patch(`/api/users/${agentId}`)
      .set('Cookie', adminCookie)
      .send({ isActive: false })

    const res = await request(app)
      .patch(`/api/users/${agentId}`)
      .set('Cookie', adminCookie)
      .send({ isActive: true })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).isActive).toBe(true)
    // A revoked token stays revoked: reactivation is not a way back into a
    // session that was already taken away.
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401)

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'agent@example.com', password })
    expect(login.status).toBe(200)
  })

  test('is a no-op on a user who is already active', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    await sessionCookieFor(agent.id)

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: true })

    expect(res.status).toBe(200)
    // Reactivating an active user must not sweep away the sessions they hold.
    expect(await prisma.session.count({ where: { userId: agent.id } })).toBe(1)
  })

  test('does not revive a session created while the agent was inactive', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const adminCookie = await sessionCookieFor(admin.id)
    const agent = await createUser()

    await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', adminCookie)
      .send({ isActive: false })

    // Where a racing login leaves things: it read the agent as active before
    // the deactivation committed, and inserted its session after the delete.
    const straggler = await sessionCookieFor(agent.id)
    expect((await request(app).get('/api/auth/me').set('Cookie', straggler)).status).toBe(401)

    await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', adminCookie)
      .send({ isActive: true })

    // Without the delete on reactivation this answers 200: a session nobody
    // issued to an active user, handed back by the reactivation.
    expect((await request(app).get('/api/auth/me').set('Cookie', straggler)).status).toBe(401)
    expect(await prisma.session.count({ where: { userId: agent.id } })).toBe(0)
  })
})

describe('PATCH /api/users/:id refusing the request', () => {
  test('refuses an admin deactivating their own account', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const cookie = await sessionCookieFor(admin.id)

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Cookie', cookie)
      .send({ isActive: false })

    expect(res.status).toBe(409)
    // Nothing moved: the admin is still active and still signed in.
    expect((await prisma.user.findUnique({ where: { id: admin.id } }))?.isActive).toBe(true)
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200)
  })

  test('refuses to deactivate the seeded admin, even for another admin', async () => {
    const seeded = await createUser({ role: 'admin', email: 'seed@example.com', isProtected: true })
    const seededCookie = await sessionCookieFor(seeded.id)
    const other = await createUser({ role: 'admin', email: 'other@example.com' })

    const res = await request(app)
      .patch(`/api/users/${seeded.id}`)
      .set('Cookie', await sessionCookieFor(other.id))
      .send({ isActive: false })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'This account cannot be deactivated' })
    // Nothing moved: still active, and still signed in.
    expect((await prisma.user.findUnique({ where: { id: seeded.id } }))?.isActive).toBe(true)
    expect((await request(app).get('/api/auth/me').set('Cookie', seededCookie)).status).toBe(200)
  })

  test('reports the seeded admin as protected in the list', async () => {
    const seeded = await createUser({ role: 'admin', email: 'seed@example.com', isProtected: true })
    await createUser()

    const res = await request(app)
      .get('/api/users')
      .set('Cookie', await sessionCookieFor(seeded.id))

    const body = res.body as UserSummary[]
    expect(body.find((u) => u.email === 'seed@example.com')?.isProtected).toBe(true)
    expect(body.find((u) => u.email === 'agent@example.com')?.isProtected).toBe(false)
  })

  test('lets the seeded admin deactivate another admin', async () => {
    const seeded = await createUser({ role: 'admin', email: 'seed@example.com', isProtected: true })
    const second = await createUser({ role: 'admin', email: 'second@example.com' })

    const res = await request(app)
      .patch(`/api/users/${second.id}`)
      .set('Cookie', await sessionCookieFor(seeded.id))
      .send({ isActive: false })

    // The self guard must not make an admin account unremovable.
    expect(res.status).toBe(200)
    expect((res.body as UserSummary).isActive).toBe(false)
  })

  test('refuses an admin who is not the seeded one deactivating another admin', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const second = await createUser({ role: 'admin', email: 'second@example.com' })

    const res = await request(app)
      .patch(`/api/users/${second.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    // Two ordinary admins deactivating each other at once used to leave nobody
    // who could manage users. Only the seeded admin touches another admin now.
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Only the seeded admin can change another admin' })
    expect((await prisma.user.findUnique({ where: { id: second.id } }))?.isActive).toBe(true)
  })

  test('answers 404 for an id that names no user', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .patch('/api/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'User not found' })
  })

  test('answers 404 for a malformed id rather than a 500', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .patch('/api/users/not-a-uuid')
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ isActive: false })

    expect(res.status).toBe(404)
  })

  test('rejects an empty change, a wrong type, and fields it does not accept', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    const cookie = await sessionCookieFor(admin.id)

    for (const payload of [
      {},
      { isActive: 'false' },
      // Stripped, leaving nothing to change: a 400, not a silent no-op.
      { role: 'admin' },
      { isProtected: true },
      { email: 'not-an-email' },
      { name: '   ' },
      { name: 'a'.repeat(101) },
      { password: 'short' },
      { password: 'a'.repeat(201) },
    ]) {
      const res = await request(app)
        .patch(`/api/users/${agent.id}`)
        .set('Cookie', cookie)
        .send(payload)
      expect(res.status).toBe(400)
    }

    expect((await prisma.user.findUnique({ where: { id: agent.id } }))?.isActive).toBe(true)
  })

  test('gives an agent 403 and leaves the target active', async () => {
    const caller = await createUser()
    const target = await createUser({ email: 'target@example.com' })

    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Cookie', await sessionCookieFor(caller.id))
      .send({ isActive: false })

    expect(res.status).toBe(403)
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.isActive).toBe(true)
  })

  test('gives an unauthenticated caller 401 and leaves the target active', async () => {
    const target = await createUser({ email: 'target@example.com' })

    const res = await request(app).patch(`/api/users/${target.id}`).send({ isActive: false })

    expect(res.status).toBe(401)
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.isActive).toBe(true)
  })
})

describe('PATCH /api/users/:id editing details', () => {
  const oldPassword = 'the-old-password-1'
  const newPassword = 'the-new-password-2'

  /** An agent with a real hash, so a login can prove which password works. */
  async function agentWithPassword() {
    return createUser({ name: 'Agent', password: oldPassword })
  }

  const login = (email: string, password: string) =>
    request(app).post('/api/auth/login').send({ email, password })

  test('renames an agent, trimmed, and leaves their sessions alone', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    const agentCookie = await sessionCookieFor(agent.id)

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ name: '  Renamed Agent  ' })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).name).toBe('Renamed Agent')
    // A new name is no reason to sign anyone out.
    expect((await request(app).get('/api/auth/me').set('Cookie', agentCookie)).status).toBe(200)
  })

  test('changes an email, lowercased, and the agent signs in with the new one', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await agentWithPassword()

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ email: 'Moved@Example.COM' })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).email).toBe('moved@example.com')
    expect((await login('moved@example.com', oldPassword)).status).toBe(200)
    expect((await login('agent@example.com', oldPassword)).status).toBe(401)
  })

  test('refuses an email another user already has, and changes nothing', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await createUser()
    await createUser({ email: 'taken@example.com', name: 'Taken' })

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ email: 'TAKEN@example.com', name: 'Should Not Stick' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A user with that email already exists' })
    // One transaction: the name in the same request did not land either.
    const after = await prisma.user.findUnique({ where: { id: agent.id } })
    expect(after?.email).toBe('agent@example.com')
    expect(after?.name).toBe('agent')
  })

  test("sets a password, which works, and ends the agent's sessions", async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const agent = await agentWithPassword()
    const agentCookie = await sessionCookieFor(agent.id)

    const res = await request(app)
      .patch(`/api/users/${agent.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ password: newPassword })

    expect(res.status).toBe(200)
    expect(res.text).not.toContain(newPassword)
    expect(res.text).not.toContain('passwordHash')
    // Whoever was signed in with the old password is out.
    expect((await request(app).get('/api/auth/me').set('Cookie', agentCookie)).status).toBe(401)
    expect((await login('agent@example.com', newPassword)).status).toBe(200)
    expect((await login('agent@example.com', oldPassword)).status).toBe(401)
  })

  test('an admin changing their own password stays signed in, and only there', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const here = await sessionCookieFor(admin.id)
    const elsewhere = await sessionCookieFor(admin.id)

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Cookie', here)
      .send({ password: newPassword })

    expect(res.status).toBe(200)
    expect((await request(app).get('/api/auth/me').set('Cookie', here)).status).toBe(200)
    expect((await request(app).get('/api/auth/me').set('Cookie', elsewhere)).status).toBe(401)
  })

  test('lets an admin who is not the seeded one edit their own details', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Cookie', await sessionCookieFor(admin.id))
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).name).toBe('New Name')
  })

  test("refuses an admin who is not the seeded one editing another admin's details", async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const seeded = await createUser({ role: 'admin', email: 'seed@example.com', isProtected: true })
    const other = await createUser({ role: 'admin', email: 'other@example.com' })
    const cookie = await sessionCookieFor(admin.id)

    for (const target of [seeded, other]) {
      const res = await request(app)
        .patch(`/api/users/${target.id}`)
        .set('Cookie', cookie)
        .send({ password: newPassword })

      // Changing another admin's password would lock them out as surely as
      // deactivating them.
      expect(res.status).toBe(403)
      expect((await prisma.user.findUnique({ where: { id: target.id } }))?.passwordHash).toBe(
        'not-used-here',
      )
    }
  })

  test("lets the seeded admin edit another admin's details", async () => {
    const seeded = await createUser({ role: 'admin', email: 'seed@example.com', isProtected: true })
    const other = await createUser({ role: 'admin', email: 'other@example.com' })

    const res = await request(app)
      .patch(`/api/users/${other.id}`)
      .set('Cookie', await sessionCookieFor(seeded.id))
      .send({ name: 'Renamed By Seed' })

    expect(res.status).toBe(200)
    expect((res.body as UserSummary).name).toBe('Renamed By Seed')
  })
})
