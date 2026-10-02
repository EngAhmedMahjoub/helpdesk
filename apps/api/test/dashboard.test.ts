import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { DashboardResponse, TicketListResponse } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { resetDatabase } from './db.ts'
import { createTicket, createUser, sessionCookieFor } from './fixtures.ts'

beforeEach(resetDatabase)

const app = createApp()

/** GET a path as a newly created, signed-in user of this role. */
async function getAs(path: string, role: 'agent' | 'admin' = 'agent') {
  const user = await createUser({ role })
  return request(app)
    .get(path)
    .set('Cookie', await sessionCookieFor(user.id))
}

describe('GET /api/dashboard', () => {
  test('refuses a caller with no session', async () => {
    const res = await request(app).get('/api/dashboard')

    expect(res.status).toBe(401)
  })

  test('answers zero for every status and category when there are no tickets', async () => {
    const res = await getAs('/api/dashboard')

    expect(res.status).toBe(200)
    expect(res.body as DashboardResponse).toEqual({
      total: 0,
      byStatus: { open: 0, resolved: 0, closed: 0 },
      byCategory: { general: 0, technical: 0, refund: 0 },
      uncategorized: 0,
      needsAgent: 0,
    })
  })

  test('counts tickets by status, by category, and those needing an agent', async () => {
    await createTicket({ status: 'open', category: 'refund', needsAgent: true })
    await createTicket({ status: 'open', category: 'technical' })
    await createTicket({ status: 'open' })
    await createTicket({ status: 'resolved', category: 'technical' })
    await createTicket({ status: 'closed', category: 'general', needsAgent: true })

    const res = await getAs('/api/dashboard')

    expect(res.status).toBe(200)
    expect(res.body as DashboardResponse).toEqual({
      total: 5,
      byStatus: { open: 3, resolved: 1, closed: 1 },
      byCategory: { general: 1, technical: 2, refund: 1 },
      uncategorized: 1,
      needsAgent: 2,
    })
  })

  test('answers an admin as it answers an agent', async () => {
    await createTicket({ category: 'general' })

    const res = await getAs('/api/dashboard', 'admin')

    expect(res.status).toBe(200)
    expect((res.body as DashboardResponse).total).toBe(1)
  })

  // The dashboard links to that list (7.2), so its count must be the list's total.
  test('counts as many needing an agent as the ticket list filtered to them holds', async () => {
    await createTicket({ status: 'open', needsAgent: true })
    await createTicket({ status: 'resolved', needsAgent: true })
    await createTicket({ status: 'closed', needsAgent: true })
    await createTicket({ status: 'open' })

    const user = await createUser()
    const cookie = await sessionCookieFor(user.id)
    const dashboard = await request(app).get('/api/dashboard').set('Cookie', cookie)
    const list = await request(app).get('/api/tickets?needsAgent=true').set('Cookie', cookie)

    expect((dashboard.body as DashboardResponse).needsAgent).toBe(3)
    expect((list.body as TicketListResponse).total).toBe(3)
  })
})
