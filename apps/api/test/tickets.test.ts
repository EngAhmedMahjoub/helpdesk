import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { TicketDetail, TicketListResponse } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { prisma, resetDatabase } from './db.ts'
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

describe('GET /api/tickets/:id', () => {
  const detail = (id: number | string) =>
    request(app)
      .get(`/api/tickets/${String(id)}`)
      .set('Cookie', agentCookie)

  test('returns the ticket with its thread, oldest message first', async () => {
    const replier = await createUser({ email: 'gil@example.com', name: 'Gil Agent' })
    const ticket = await createTicket({
      subject: 'Quiz shows zero',
      studentName: 'Sam Wright',
      status: 'resolved',
      category: 'technical',
      summary: 'Quiz 3 scored 0 after submitting',
      autoCloseAt: day(20),
      createdAt: day(1),
      updatedAt: day(6),
    })
    // Created out of order, so the response's order is the query's, not insertion's.
    const reply = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        direction: 'outbound',
        author: 'agent',
        agentId: replier.id,
        body: 'Checking the grading log now.',
        createdAt: day(3),
      },
    })
    const question = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        direction: 'inbound',
        author: 'student',
        body: 'My quiz says 0 out of 10.',
        emailMessageId: '<q@student.example>',
        createdAt: day(1),
      },
    })
    const answer = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        direction: 'outbound',
        author: 'ai',
        body: 'Scores can take an hour to appear.',
        emailMessageId: '<a@helpdesk.example>',
        createdAt: day(2),
      },
    })

    const res = await detail(ticket.id)

    expect(res.status).toBe(200)
    expect(res.body as TicketDetail).toEqual({
      id: ticket.id,
      subject: 'Quiz shows zero',
      studentEmail: 'student@example.com',
      studentName: 'Sam Wright',
      status: 'resolved',
      category: 'technical',
      needsAgent: false,
      escalationReason: null,
      summary: 'Quiz 3 scored 0 after submitting',
      autoCloseAt: day(20).toISOString(),
      createdAt: day(1).toISOString(),
      updatedAt: day(6).toISOString(),
      messages: [
        {
          id: question.id,
          direction: 'inbound',
          author: 'student',
          agent: null,
          body: 'My quiz says 0 out of 10.',
          createdAt: day(1).toISOString(),
        },
        {
          id: answer.id,
          direction: 'outbound',
          author: 'ai',
          agent: null,
          body: 'Scores can take an hour to appear.',
          createdAt: day(2).toISOString(),
        },
        {
          id: reply.id,
          direction: 'outbound',
          author: 'agent',
          agent: { id: replier.id, name: 'Gil Agent' },
          body: 'Checking the grading log now.',
          createdAt: day(3).toISOString(),
        },
      ],
    })
    // The agent is named, never serialised whole.
    expect(res.text).not.toContain('passwordHash')
    expect(res.text).not.toContain('gil@example.com')
  })

  test('returns an empty thread for a ticket with no messages', async () => {
    const ticket = await createTicket()

    const res = await detail(ticket.id)

    expect(res.status).toBe(200)
    expect((res.body as TicketDetail).messages).toEqual([])
  })

  test("returns only its own ticket's messages", async () => {
    const mine = await createTicket({ subject: 'Mine' })
    const other = await createTicket({ subject: 'Other' })
    for (const ticketId of [mine.id, other.id]) {
      await prisma.message.create({
        data: {
          ticketId,
          direction: 'inbound',
          author: 'student',
          body: `For ${String(ticketId)}`,
        },
      })
    }

    const res = await detail(mine.id)

    expect((res.body as TicketDetail).messages.map((m) => m.body)).toEqual([
      `For ${String(mine.id)}`,
    ])
  })

  test('gives an unauthenticated caller 401', async () => {
    const ticket = await createTicket()

    const res = await request(app).get(`/api/tickets/${String(ticket.id)}`)

    expect(res.status).toBe(401)
    expect(res.text).not.toContain('student@example.com')
  })

  test('answers 404 for an id with no ticket', async () => {
    const ticket = await createTicket()

    const res = await detail(ticket.id + 1)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Ticket not found' })
  })

  test("does not accept another spelling of a real ticket's id", async () => {
    const ticket = await createTicket()
    const n = String(ticket.id)

    // Number() reads each of these as the ticket's id; only the digits name it.
    for (const alias of [`+${n}`, `${n}.0`, `0${n}`, `%20${n}`]) {
      const res = await detail(alias)
      expect(res.status).toBe(404)
    }
    expect((await detail(n)).status).toBe(200)
  })

  // Each would reach Postgres as something other than a ticket id, or not at
  // all: "1e2" and " 1" because Number() accepts them, the last because it
  // overflows the INTEGER column.
  for (const id of ['abc', '0', '-1', '1.5', '1e2', '%201', '0x10', '2147483648']) {
    test(`answers 404 for the malformed id "${id}"`, async () => {
      await createTicket()

      const res = await detail(id)

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Ticket not found' })
    })
  }
})

describe('PATCH /api/tickets/:id', () => {
  const patch = (id: number | string, body: object, cookie = agentCookie) =>
    request(app)
      .patch(`/api/tickets/${String(id)}`)
      .set('Cookie', cookie)
      .send(body)

  const stored = (id: number) => prisma.ticket.findUniqueOrThrow({ where: { id } })

  test('changes the status and answers with the ticket and its thread', async () => {
    const ticket = await createTicket({ status: 'open' })
    await prisma.message.create({
      data: { ticketId: ticket.id, direction: 'inbound', author: 'student', body: 'Help' },
    })

    const res = await patch(ticket.id, { status: 'closed' })

    expect(res.status).toBe(200)
    const body = res.body as TicketDetail
    expect(body).toMatchObject({ id: ticket.id, status: 'closed' })
    expect(body.messages.map((m) => m.body)).toEqual(['Help'])
    expect((await stored(ticket.id)).status).toBe('closed')
  })

  test('changes the category', async () => {
    const ticket = await createTicket({ category: null })

    const res = await patch(ticket.id, { category: 'refund' })

    expect(res.status).toBe(200)
    expect((await stored(ticket.id)).category).toBe('refund')
  })

  test('clears needsAgent, and the escalation reason with it', async () => {
    const ticket = await createTicket({ needsAgent: true, escalationReason: 'refund_approval' })

    const res = await patch(ticket.id, { needsAgent: false })

    expect(res.status).toBe(200)
    expect(res.body as TicketDetail).toMatchObject({ needsAgent: false, escalationReason: null })
    expect(await stored(ticket.id)).toMatchObject({ needsAgent: false, escalationReason: null })
  })

  test('changes several fields at once and leaves the rest alone', async () => {
    const ticket = await createTicket({
      status: 'open',
      category: 'general',
      needsAgent: true,
      escalationReason: 'ai_failed',
      summary: 'Kept',
    })

    await patch(ticket.id, { status: 'resolved', category: 'technical' })

    expect(await stored(ticket.id)).toMatchObject({
      status: 'resolved',
      category: 'technical',
      // Not in the request, so not touched.
      needsAgent: true,
      escalationReason: 'ai_failed',
      summary: 'Kept',
      subject: 'Cannot log in',
    })
  })

  test('is open to admins as well as agents', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin@example.com' })
    const ticket = await createTicket()

    const res = await patch(ticket.id, { status: 'closed' }, await sessionCookieFor(admin.id))

    expect(res.status).toBe(200)
  })

  test('gives an unauthenticated caller 401 and changes nothing', async () => {
    const ticket = await createTicket({ status: 'open' })

    const res = await request(app)
      .patch(`/api/tickets/${String(ticket.id)}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(401)
    expect((await stored(ticket.id)).status).toBe('open')
  })

  test('answers 404 for an id with no ticket, and for a malformed one', async () => {
    const ticket = await createTicket()

    for (const id of [String(ticket.id + 1), 'abc', '1e2', '2147483648']) {
      const res = await patch(id, { status: 'closed' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Ticket not found' })
    }
  })

  const invalid: [string, object][] = [
    ['an empty body', {}],
    ['an unknown status', { status: 'pending' }],
    ['an unknown category', { category: 'billing' }],
    ['a null category', { category: null }],
    ['setting needsAgent', { needsAgent: true }],
    ['needsAgent as a string', { needsAgent: 'false' }],
    // Stripped, leaving nothing to change: a 400 rather than a silent no-op.
    ['only fields it does not accept', { subject: 'Hijacked', escalationReason: null }],
  ]

  for (const [label, payload] of invalid) {
    test(`rejects ${label} and changes nothing`, async () => {
      const ticket = await createTicket({
        status: 'open',
        category: 'general',
        needsAgent: true,
        escalationReason: 'ai_failed',
      })
      const before = await stored(ticket.id)

      const res = await patch(ticket.id, payload)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid request body' })
      expect(await stored(ticket.id)).toEqual(before)
    })
  }

  test('rejects a bad value even beside a valid one, and changes nothing', async () => {
    const ticket = await createTicket({ status: 'open', category: 'general' })

    const res = await patch(ticket.id, { status: 'closed', category: 'billing' })

    expect(res.status).toBe(400)
    expect(await stored(ticket.id)).toMatchObject({ status: 'open', category: 'general' })
  })

  describe('status transitions', () => {
    const DAY = 24 * 60 * 60 * 1000
    // A running timer from an earlier resolution, so every transition shows
    // whether it restarts, clears or leaves it.
    const earlierTimer = new Date(Date.now() + 3 * DAY)
    const statuses = ['open', 'resolved', 'closed'] as const

    for (const from of statuses) {
      for (const to of statuses) {
        test(`${from} to ${to} ${to === 'resolved' ? 'starts a fresh 14-day timer' : 'leaves no timer'}`, async () => {
          const ticket = await createTicket({
            status: from,
            autoCloseAt: from === 'resolved' ? earlierTimer : null,
          })

          const before = Date.now()
          const res = await patch(ticket.id, { status: to })
          const after = Date.now()

          expect(res.status).toBe(200)
          const { status, autoCloseAt } = await stored(ticket.id)
          expect(status).toBe(to)
          if (to === 'resolved') {
            expect(autoCloseAt?.getTime()).toBeGreaterThanOrEqual(before + 14 * DAY)
            expect(autoCloseAt?.getTime()).toBeLessThanOrEqual(after + 14 * DAY)
            expect((res.body as TicketDetail).autoCloseAt).toBe(autoCloseAt?.toISOString() ?? '')
          } else {
            expect(autoCloseAt).toBeNull()
            expect((res.body as TicketDetail).autoCloseAt).toBeNull()
          }
        })
      }
    }

    test('a change without a status leaves a running timer alone', async () => {
      const ticket = await createTicket({ status: 'resolved', autoCloseAt: earlierTimer })

      await patch(ticket.id, { category: 'technical', needsAgent: false })

      expect((await stored(ticket.id)).autoCloseAt).toEqual(earlierTimer)
    })
  })

  test('ignores a field it does not accept beside one it does', async () => {
    const ticket = await createTicket({ subject: 'Original' })

    const res = await patch(ticket.id, { status: 'closed', subject: 'Hijacked' })

    expect(res.status).toBe(200)
    expect(await stored(ticket.id)).toMatchObject({ status: 'closed', subject: 'Original' })
  })
})
