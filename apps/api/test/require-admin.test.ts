import { beforeEach, describe, expect, test } from 'bun:test'
import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import type { Role } from '@helpdesk/shared'
import { requireAdmin, requireAuth } from '../src/auth/middleware.ts'
import { prisma, resetDatabase } from './db.ts'
import { createUser, sessionCookieFor } from './fixtures.ts'

// The first real admin route is 2.1 (GET /api/users), so requireAdmin is
// mounted here on a stub behind the same requireAuth it will sit behind there.
const app = express()
app.use(cookieParser())
app.get('/admin-only', requireAuth, requireAdmin, (req, res) => {
  res.json({ role: req.user?.role })
})

async function signIn(role: Role) {
  const user = await createUser({ role })
  return sessionCookieFor(user.id)
}

beforeEach(resetDatabase)

describe('requireAdmin', () => {
  test('gives an agent 403 on an admin route', async () => {
    const res = await request(app)
      .get('/admin-only')
      .set('Cookie', await signIn('agent'))

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
  })

  test('lets an admin through', async () => {
    const res = await request(app)
      .get('/admin-only')
      .set('Cookie', await signIn('admin'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ role: 'admin' })
  })

  test('gives an unauthenticated caller 401 from requireAuth, never reaching requireAdmin', async () => {
    const res = await request(app).get('/admin-only')

    expect(res.status).toBe(401)
  })

  test('refuses an agent whose session is perfectly valid', async () => {
    const cookie = await signIn('agent')

    // Nothing wrong with the session: the role alone is the reason.
    expect(await prisma.session.count()).toBe(1)
    const res = await request(app).get('/admin-only').set('Cookie', cookie)

    expect(res.status).toBe(403)
  })

  test('follows a role change on the next request', async () => {
    const cookie = await signIn('agent')
    expect((await request(app).get('/admin-only').set('Cookie', cookie)).status).toBe(403)

    // The role is read from the database per request, not frozen into the
    // session, so a promotion takes effect without a new login.
    await prisma.user.update({ where: { email: 'agent@example.com' }, data: { role: 'admin' } })

    expect((await request(app).get('/admin-only').set('Cookie', cookie)).status).toBe(200)
  })
})

describe('requireAdmin used without requireAuth', () => {
  test('refuses everyone rather than failing open', async () => {
    const unguarded = express()
    unguarded.get('/mistake', requireAdmin, (_req, res) => {
      res.json({ ok: true })
    })

    const res = await request(unguarded)
      .get('/mistake')
      .set('Cookie', await signIn('admin'))

    // A route wired up wrongly must deny, not admit a real admin by accident.
    expect(res.status).toBe(403)
  })
})
