import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { TicketListResponse } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { resetDatabase } from './db.ts'
import { createTicket, createUser, sessionCookieFor } from './fixtures.ts'

const app = createApp()

let agentCookie: string

beforeEach(async () => {
  await resetDatabase()
  agentCookie = await sessionCookieFor((await createUser()).id)
})

const day = (n: number) => new Date(Date.UTC(2026, 8, n, 9))

/** GETs the list as a signed-in agent. */
const list = (query = '') => request(app).get(`/api/tickets${query}`).set('Cookie', agentCookie)

const subjects = (res: request.Response) =>
  (res.body as TicketListResponse).tickets.map((ticket) => ticket.subject)

describe('GET /api/tickets access', () => {
  test('gives an unauthenticated caller 401', async () => {
    await createTicket()

    const res = await request(app).get('/api/tickets')

    expect(res.status).toBe(401)
    expect(res.text).not.toContain('student@example.com')
  })

  test('is open to agents, not only admins', async () => {
    await createTicket()

    const res = await list()

    expect(res.status).toBe(200)
    expect((res.body as TicketListResponse).total).toBe(1)
  })
})

describe('GET /api/tickets defaults', () => {
  test('returns every ticket, most recently updated first, as summaries', async () => {
    const older = await createTicket({
      subject: 'Older',
      studentName: 'Maya Chen',
      category: 'technical',
      summary: 'Not for the list',
      needsAgent: true,
      escalationReason: 'ai_failed',
      createdAt: day(1),
      updatedAt: day(2),
    })
    await createTicket({ subject: 'Newer', createdAt: day(1), updatedAt: day(5) })

    const res = await list()

    expect(res.status).toBe(200)
    const body = res.body as TicketListResponse
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 2 })
    expect(subjects(res)).toEqual(['Newer', 'Older'])
    // Exactly these keys: summary and autoCloseAt belong to the detail view.
    expect(body.tickets[1]).toEqual({
      id: older.id,
      subject: 'Older',
      studentEmail: 'student@example.com',
      studentName: 'Maya Chen',
      status: 'open',
      category: 'technical',
      needsAgent: true,
      escalationReason: 'ai_failed',
      createdAt: day(1).toISOString(),
      updatedAt: day(2).toISOString(),
    })
  })

  test('returns an empty page, not an error, when there are no tickets', async () => {
    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tickets: [], page: 1, pageSize: 20, total: 0 })
  })
})

describe('GET /api/tickets filters', () => {
  beforeEach(async () => {
    await createTicket({ subject: 'Open general', status: 'open', category: 'general' })
    await createTicket({ subject: 'Open refund', status: 'open', category: 'refund' })
    await createTicket({ subject: 'Resolved technical', status: 'resolved', category: 'technical' })
    await createTicket({ subject: 'Closed refund', status: 'closed', category: 'refund' })
    await createTicket({ subject: 'Open unclassified', status: 'open', category: null })
  })

  test('by status', async () => {
    const res = await list('?status=open&sort=createdAt&order=asc')

    expect(subjects(res)).toEqual(['Open general', 'Open refund', 'Open unclassified'])
    expect((res.body as TicketListResponse).total).toBe(3)
  })

  test('by category', async () => {
    const res = await list('?category=refund&sort=createdAt&order=asc')

    expect(subjects(res)).toEqual(['Open refund', 'Closed refund'])
    expect((res.body as TicketListResponse).total).toBe(2)
  })

  test('by status and category together', async () => {
    const res = await list('?status=open&category=refund')

    expect(subjects(res)).toEqual(['Open refund'])
    expect((res.body as TicketListResponse).total).toBe(1)
  })
})

describe('GET /api/tickets sorting', () => {
  // Created and updated in different orders, so each sort gives its own answer.
  beforeEach(async () => {
    await createTicket({ subject: 'A', createdAt: day(1), updatedAt: day(9) })
    await createTicket({ subject: 'B', createdAt: day(2), updatedAt: day(3) })
    await createTicket({ subject: 'C', createdAt: day(3), updatedAt: day(6) })
  })

  test('by created, newest first', async () => {
    expect(subjects(await list('?sort=createdAt&order=desc'))).toEqual(['C', 'B', 'A'])
  })

  test('by created, oldest first', async () => {
    expect(subjects(await list('?sort=createdAt&order=asc'))).toEqual(['A', 'B', 'C'])
  })

  test('by updated, most recent first', async () => {
    expect(subjects(await list('?sort=updatedAt&order=desc'))).toEqual(['A', 'C', 'B'])
  })

  test('by updated, least recent first', async () => {
    expect(subjects(await list('?sort=updatedAt&order=asc'))).toEqual(['B', 'C', 'A'])
  })
})

describe('GET /api/tickets tie-break', () => {
  test('orders tickets with the same timestamp by id, so pages stay stable', async () => {
    for (const subject of ['First', 'Second', 'Third']) {
      await createTicket({ subject, createdAt: day(1), updatedAt: day(1) })
    }

    expect(subjects(await list('?order=asc'))).toEqual(['First', 'Second', 'Third'])
    expect(subjects(await list('?order=desc'))).toEqual(['Third', 'Second', 'First'])
  })
})

describe('GET /api/tickets pagination', () => {
  beforeEach(async () => {
    for (let n = 1; n <= 5; n += 1) {
      await createTicket({ subject: `T${String(n)}`, createdAt: day(n), updatedAt: day(n) })
    }
  })

  test('returns the requested page and the total across all pages', async () => {
    const res = await list('?sort=createdAt&order=asc&page=2&pageSize=2')

    expect(subjects(res)).toEqual(['T3', 'T4'])
    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 5 })
  })

  test('returns a short last page', async () => {
    expect(subjects(await list('?sort=createdAt&order=asc&page=3&pageSize=2'))).toEqual(['T5'])
  })

  test('returns an empty page past the end, still with the total', async () => {
    const res = await list('?page=4&pageSize=2')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ tickets: [], page: 4, total: 5 })
  })
})

describe('GET /api/tickets with an invalid query', () => {
  const cases: [string, string][] = [
    ['an unknown status', '?status=pending'],
    ['an unknown category', '?category=billing'],
    ['a sort on another column', '?sort=subject'],
    ['an unknown order', '?order=up'],
    ['page 0', '?page=0'],
    ['a page that is not a number', '?page=abc'],
    ['a fractional page', '?page=1.5'],
    ['a page size over the cap', '?pageSize=101'],
    ['a status given twice', '?status=open&status=closed'],
  ]

  for (const [label, query] of cases) {
    test(`rejects ${label}`, async () => {
      const res = await list(query)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid query' })
    })
  }
})
