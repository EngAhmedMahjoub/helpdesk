import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { env } from '../src/env.ts'
import { prisma, resetDatabase } from './db.ts'
import { createTicket, createUser, sessionCookieFor } from './fixtures.ts'

beforeEach(resetDatabase)

const app = createApp()
const DAY = 24 * 60 * 60 * 1000

const autoClose = (authorization = `Bearer ${env.TASKS_SECRET}`) =>
  request(app).post('/api/tasks/auto-close').set('Authorization', authorization)

const stored = (id: number) => prisma.ticket.findUniqueOrThrow({ where: { id } })

describe('POST /api/tasks/auto-close', () => {
  test('closes a Resolved ticket whose timer has run out, and leaves one still running', async () => {
    const expired = await createTicket({
      status: 'resolved',
      autoCloseAt: new Date(Date.now() - DAY),
    })
    const running = await createTicket({
      status: 'resolved',
      autoCloseAt: new Date(Date.now() + DAY),
    })

    const res = await autoClose()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ closed: 1 })
    // Closed through statusChange, so the timer goes with the status.
    expect(await stored(expired.id)).toMatchObject({ status: 'closed', autoCloseAt: null })
    const stillResolved = await stored(running.id)
    expect(stillResolved.status).toBe('resolved')
    expect(stillResolved.autoCloseAt?.getTime()).toBe(running.autoCloseAt?.getTime())
  })

  test('leaves Open and Closed tickets alone, whatever their timer says', async () => {
    // statusChange never leaves a timer on these, but a stray one must not
    // turn an Open ticket nobody answered into a Closed one.
    const open = await createTicket({ status: 'open', autoCloseAt: new Date(Date.now() - DAY) })

    const res = await autoClose()

    expect(res.body).toEqual({ closed: 0 })
    expect((await stored(open.id)).status).toBe('open')
  })

  test('closes nothing on a second call', async () => {
    await createTicket({ status: 'resolved', autoCloseAt: new Date(Date.now() - DAY) })

    await autoClose()
    const res = await autoClose()

    expect(res.body).toEqual({ closed: 0 })
  })

  describe('the shared secret', () => {
    test.each([
      ['no Authorization header', undefined],
      ['a wrong secret', 'Bearer not-the-secret'],
      ['the secret without the Bearer scheme', env.TASKS_SECRET],
      ['an empty bearer token', 'Bearer '],
    ])('refuses %s with 401, closing nothing', async (_label, authorization) => {
      const expired = await createTicket({
        status: 'resolved',
        autoCloseAt: new Date(Date.now() - DAY),
      })

      const req = request(app).post('/api/tasks/auto-close')
      const res = await (authorization === undefined
        ? req
        : req.set('Authorization', authorization))

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Unauthorized' })
      expect((await stored(expired.id)).status).toBe('resolved')
    })

    test("an admin's session is not enough", async () => {
      // The route is for the workflow alone; a signed-in user has no way in.
      const admin = await createUser({ role: 'admin' })

      const res = await request(app)
        .post('/api/tasks/auto-close')
        .set('Cookie', await sessionCookieFor(admin.id))

      expect(res.status).toBe(401)
    })
  })
})
