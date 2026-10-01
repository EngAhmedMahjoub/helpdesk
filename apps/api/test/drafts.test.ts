import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { DraftListResponse } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { prisma, resetDatabase } from './db.ts'
import { createTicket, createUser, sessionCookieFor } from './fixtures.ts'

beforeEach(resetDatabase)

const app = createApp()
const HOUR = 60 * 60 * 1000

/** GET /api/drafts as a signed-in agent. */
async function listAs(query: string, role: 'agent' | 'admin' = 'agent') {
  const user = await createUser({ role })
  return request(app)
    .get(`/api/drafts${query}`)
    .set('Cookie', await sessionCookieFor(user.id))
}

/** A draft on a new ticket, created `ago` milliseconds back. */
async function draft(
  body: string,
  {
    ago = 0,
    status = 'pending' as const,
    ticket = {},
  }: {
    ago?: number
    status?: 'pending' | 'approved' | 'rejected'
    ticket?: Parameters<typeof createTicket>[0]
  } = {},
) {
  const owner = await createTicket({
    needsAgent: true,
    escalationReason: 'refund_approval',
    ...ticket,
  })
  const reviewed =
    status === 'pending'
      ? {}
      : {
          reviewedById: (await createUser({ email: `reviewer-${body}@example.com` })).id,
          reviewedAt: new Date(Date.now() - ago),
        }
  return prisma.replyDraft.create({
    data: {
      ticketId: owner.id,
      body,
      status,
      ...reviewed,
      createdAt: new Date(Date.now() - ago),
    },
  })
}

describe('GET /api/drafts', () => {
  test('refuses a caller with no session', async () => {
    const res = await request(app).get('/api/drafts?status=pending')

    expect(res.status).toBe(401)
  })

  test('lists only the drafts in the status asked for', async () => {
    const pending = await draft('Waiting')
    await draft('Sent', { status: 'approved' })
    await draft('Thrown out', { status: 'rejected' })

    const res = await listAs('?status=pending')

    expect(res.status).toBe(200)
    const { drafts } = res.body as DraftListResponse
    expect(drafts.map((d) => d.id)).toEqual([pending.id])
  })

  test('lists pending drafts for an admin too', async () => {
    await draft('Waiting')

    const res = await listAs('?status=pending', 'admin')

    expect((res.body as DraftListResponse).drafts).toHaveLength(1)
  })

  test.each(['', '?status=', '?status=PENDING', '?status=sent'])(
    'answers 400 for the query "%s"',
    async (query) => {
      const res = await listAs(query)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid query' })
    },
  )

  test("carries the ticket's context, including whether its sender was verified", async () => {
    // The reason a reviewer must see before approving: this address may be forged.
    await draft('Try clearing your cache.', {
      ticket: {
        subject: 'Videos',
        studentEmail: 'tom@uni.edu',
        studentName: 'Tom',
        category: 'technical',
        escalationReason: 'unverified_sender',
        senderVerified: false,
      },
    })

    const res = await listAs('?status=pending')

    const [only] = (res.body as DraftListResponse).drafts
    expect(only).toMatchObject({
      body: 'Try clearing your cache.',
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      ticket: {
        subject: 'Videos',
        studentEmail: 'tom@uni.edu',
        studentName: 'Tom',
        category: 'technical',
        escalationReason: 'unverified_sender',
        senderVerified: false,
      },
    })
  })

  test('lists pending drafts oldest first: the longest wait is at the top', async () => {
    const newer = await draft('Newer', { ago: 1 * HOUR })
    const oldest = await draft('Oldest', { ago: 3 * HOUR })
    const middle = await draft('Middle', { ago: 2 * HOUR })

    const res = await listAs('?status=pending')

    expect((res.body as DraftListResponse).drafts.map((d) => d.id)).toEqual([
      oldest.id,
      middle.id,
      newer.id,
    ])
  })

  test('lists reviewed drafts most recently reviewed first', async () => {
    const earlier = await draft('Earlier', { status: 'approved', ago: 2 * HOUR })
    const latest = await draft('Latest', { status: 'approved', ago: 1 * HOUR })

    const res = await listAs('?status=approved')

    expect((res.body as DraftListResponse).drafts.map((d) => d.id)).toEqual([latest.id, earlier.id])
  })

  test('names the reviewer by id and name only', async () => {
    const reviewed = await draft('Sent', { status: 'approved' })

    const res = await listAs('?status=approved')

    const [only] = (res.body as DraftListResponse).drafts
    expect(Object.keys(only!.reviewedBy!).sort()).toEqual(['id', 'name'])
    expect(only!.reviewedBy!.id).toBe(reviewed.reviewedById!)
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })
})
