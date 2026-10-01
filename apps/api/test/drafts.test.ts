import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import request from 'supertest'
import type { DraftListResponse } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { env } from '../src/env.ts'
import { saveDraft } from '../src/jobs/process-ticket.ts'
import { EmailSendError, type OutboundEmail } from '../src/email/outbound.ts'
import { prisma, resetDatabase } from './db.ts'
import { createMessage, createTicket, createUser, sessionCookieFor } from './fixtures.ts'

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

/** An app whose sends are recorded, or refused with `fail`. */
function appSending({ fail = false } = {}) {
  const emails: OutboundEmail[] = []
  const sending = createApp({
    sendEmail: async (email) => {
      if (fail) throw new EmailSendError('Resend refused the email: rate_limit_exceeded')
      emails.push(email)
      return { resendId: 'resend-id' }
    },
  })
  return { app: sending, emails }
}

/** A pending draft on an Open ticket from tom@uni.edu, whose email had a Message-ID. */
async function pendingDraft(ticket: Parameters<typeof createTicket>[0] = {}) {
  const owner = await createTicket({
    subject: 'Refund',
    studentEmail: 'tom@uni.edu',
    needsAgent: true,
    escalationReason: 'refund_approval',
    ...ticket,
  })
  await createMessage({ ticketId: owner.id, emailMessageId: '<tom-1@uni.edu>' })
  return prisma.replyDraft.create({
    data: { ticketId: owner.id, body: 'Your request has been passed to the team.' },
  })
}

async function approve(
  target: ReturnType<typeof appSending>['app'],
  id: number | string,
  body: object = {},
  reviewer?: { id: string },
) {
  const user = reviewer ?? (await createUser())
  // The version the agent saw: the draft's current one, unless the test says
  // otherwise. A draft that does not exist has none, so any will do.
  const current = /^\d+$/.test(String(id))
    ? await prisma.replyDraft.findUnique({ where: { id: Number(id) }, select: { updatedAt: true } })
    : null
  const updatedAt = (current?.updatedAt ?? new Date()).toISOString()
  return request(target)
    .post(`/api/drafts/${String(id)}/approve`)
    .set('Cookie', await sessionCookieFor(user.id))
    .send({ updatedAt, ...body })
}

describe('POST /api/drafts/:id/approve', () => {
  test('emails the draft to the student, threaded, and records who approved it', async () => {
    const draft = await pendingDraft()
    const { app: sending, emails } = appSending()
    const agent = await createUser()

    const res = await approve(sending, draft.id, {}, agent)

    expect(res.status).toBe(200)
    expect(emails).toEqual([
      {
        to: 'tom@uni.edu',
        subject: 'Re: Refund',
        text: 'Your request has been passed to the team.',
        thread: ['<tom-1@uni.edu>'],
      },
    ])
    expect(res.body).toMatchObject({
      id: draft.id,
      status: 'approved',
      reviewedBy: { id: agent.id, name: agent.name },
    })
    const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(stored.reviewedById).toBe(agent.id)
    expect(stored.reviewedAt).not.toBeNull()
  })

  test("sends the agent's edit instead, trimmed, and keeps it on the draft", async () => {
    const draft = await pendingDraft()
    const { app: sending, emails } = appSending()

    await approve(sending, draft.id, { body: '  Approved: £20 back within 5 days.  ' })

    expect(emails[0]!.text).toBe('Approved: £20 back within 5 days.')
    const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(stored.body).toBe('Approved: £20 back within 5 days.')
  })

  test("saves the reply as the approver's message and resolves the ticket", async () => {
    const draft = await pendingDraft()
    const agent = await createUser()

    await approve(appSending().app, draft.id, {}, agent)

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: draft.ticketId } })
    expect(ticket).toMatchObject({ status: 'resolved', needsAgent: false, escalationReason: null })
    expect(ticket.autoCloseAt).not.toBeNull()
    const reply = await prisma.message.findFirstOrThrow({
      where: { ticketId: draft.ticketId, direction: 'outbound' },
    })
    expect(reply).toMatchObject({
      author: 'agent',
      agentId: agent.id,
      body: 'Your request has been passed to the team.',
    })
  })

  test.each(['resolved', 'closed'] as const)('leaves a %s ticket in its status', async (status) => {
    const draft = await pendingDraft({ status })

    await approve(appSending().app, draft.id)

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: draft.ticketId } })
    expect(ticket).toMatchObject({ status, needsAgent: false })
  })

  test('a send Resend refuses answers 502 and leaves the draft pending, edit kept', async () => {
    const draft = await pendingDraft()

    const res = await approve(appSending({ fail: true }).app, draft.id, { body: 'Edited.' })

    expect(res.status).toBe(502)
    const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(stored).toMatchObject({
      status: 'pending',
      body: 'Edited.',
      reviewedById: null,
      reviewedAt: null,
    })
    expect(await prisma.message.count({ where: { direction: 'outbound' } })).toBe(0)
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: draft.ticketId } })).needsAgent,
    ).toBe(true)
  })

  test.each(['approved', 'rejected'] as const)(
    'refuses a draft already %s with 409, emailing nothing',
    async (status) => {
      const draft = await pendingDraft()
      const reviewer = await createUser({ email: 'first@example.com' })
      await prisma.replyDraft.update({
        where: { id: draft.id },
        data: { status, reviewedById: reviewer.id, reviewedAt: new Date() },
      })
      const { app: sending, emails } = appSending()

      const res = await approve(sending, draft.id)

      expect(res.status).toBe(409)
      expect(emails).toHaveLength(0)
    },
  )

  test('two agents approving at once email the student once', async () => {
    const draft = await pendingDraft()
    const { app: sending, emails } = appSending()
    const first = await createUser({ email: 'first@example.com' })
    const second = await createUser({ email: 'second@example.com' })

    const results = await Promise.all([
      approve(sending, draft.id, {}, first),
      approve(sending, draft.id, {}, second),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(emails).toHaveLength(1)
    expect(await prisma.message.count({ where: { direction: 'outbound' } })).toBe(1)
  })

  test.each(['999999', 'abc', '0'])('answers 404 for the draft id "%s"', async (id) => {
    const res = await approve(appSending().app, id)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Draft not found' })
  })

  test.each([{ body: '' }, { body: '   ' }, { body: 'x'.repeat(10_001) }, { body: 42 }])(
    'answers 400 for the body %j, emailing nothing',
    async (body) => {
      const draft = await pendingDraft()
      const { app: sending, emails } = appSending()

      const res = await approve(sending, draft.id, body)

      expect(res.status).toBe(400)
      expect(emails).toHaveLength(0)
      expect((await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        'pending',
      )
    },
  )

  test('refuses a caller with no session', async () => {
    const draft = await pendingDraft()

    const res = await request(appSending().app).post(`/api/drafts/${String(draft.id)}/approve`)

    expect(res.status).toBe(401)
  })
})

describe('POST /api/drafts/:id/reject', () => {
  async function reject(
    target: ReturnType<typeof appSending>['app'],
    id: number | string,
    reviewer?: { id: string },
  ) {
    const user = reviewer ?? (await createUser())
    return request(target)
      .post(`/api/drafts/${String(id)}/reject`)
      .set('Cookie', await sessionCookieFor(user.id))
  }

  test('marks the draft rejected, records who rejected it, and emails nothing', async () => {
    const draft = await pendingDraft()
    const { app: sending, emails } = appSending()
    const agent = await createUser()

    const res = await reject(sending, draft.id, agent)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: draft.id,
      status: 'rejected',
      body: 'Your request has been passed to the team.',
      reviewedBy: { id: agent.id, name: agent.name },
    })
    expect(emails).toHaveLength(0)
    const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(stored).toMatchObject({ status: 'rejected', reviewedById: agent.id })
    expect(stored.reviewedAt).not.toBeNull()
  })

  test('leaves the ticket Open and still waiting for an agent', async () => {
    // The student has not been answered: someone still has to write to them.
    const draft = await pendingDraft()

    await reject(appSending().app, draft.id)

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: draft.ticketId } })
    expect(ticket).toMatchObject({
      status: 'open',
      autoCloseAt: null,
      needsAgent: true,
      escalationReason: 'refund_approval',
    })
    expect(await prisma.message.count({ where: { direction: 'outbound' } })).toBe(0)
  })

  test.each(['approved', 'rejected'] as const)(
    'refuses a draft already %s with 409, changing nothing',
    async (status) => {
      const draft = await pendingDraft()
      const first = await createUser({ email: 'first@example.com' })
      const reviewedAt = new Date('2026-09-30T09:00:00Z')
      await prisma.replyDraft.update({
        where: { id: draft.id },
        data: { status, reviewedById: first.id, reviewedAt },
      })

      const res = await reject(appSending().app, draft.id)

      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: 'This draft has already been reviewed' })
      const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
      expect(stored.status).toBe(status)
      expect(stored.reviewedById).toBe(first.id)
      expect(stored.reviewedAt?.getTime()).toBe(reviewedAt.getTime())
    },
  )

  test('approving and rejecting at once ends in one or the other, never both', async () => {
    const draft = await pendingDraft()
    const { app: sending, emails } = appSending()
    const approver = await createUser({ email: 'approver@example.com' })
    const rejecter = await createUser({ email: 'rejecter@example.com' })

    const [approved, rejected] = await Promise.all([
      approve(sending, draft.id, {}, approver),
      reject(sending, draft.id, rejecter),
    ])

    expect([approved.status, rejected.status].sort()).toEqual([200, 409])
    const stored = await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })
    // An email went out exactly when the approval won.
    expect(emails).toHaveLength(stored.status === 'approved' ? 1 : 0)
  })

  test.each(['999999', 'abc', '0'])('answers 404 for the draft id "%s"', async (id) => {
    const res = await reject(appSending().app, id)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Draft not found' })
  })

  test('refuses a caller with no session', async () => {
    const draft = await pendingDraft()

    const res = await request(appSending().app).post(`/api/drafts/${String(draft.id)}/reject`)

    expect(res.status).toBe(401)
    expect((await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'pending',
    )
  })
})

describe('Phase 6 security fixes (#249)', () => {
  describe('1. a draft the AI rewrote is not approved unseen', () => {
    test('an approval of an older version answers 409 and sends nothing', async () => {
      const draft = await pendingDraft()
      const seen = draft.updatedAt.toISOString()
      // A follow-up arrives and the worker rewrites the draft, as saveDraft does.
      await prisma.replyDraft.updateMany({
        where: { id: draft.id, status: 'pending' },
        data: { body: 'The newer draft, answering the follow-up.' },
      })
      const { app: sending, emails } = appSending()

      const res = await approve(sending, draft.id, {
        updatedAt: seen,
        body: 'The old text, edited.',
      })

      expect(res.status).toBe(409)
      expect(res.body).toEqual({
        error:
          'The AI updated this draft after a new message from the student. Review the new version.',
      })
      expect(emails).toHaveLength(0)
      // The newer text survives, still waiting.
      expect(await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
        status: 'pending',
        body: 'The newer draft, answering the follow-up.',
      })
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: draft.ticketId } })).needsAgent,
      ).toBe(true)
    })

    test('an approval without the version it reviewed is refused with 400', async () => {
      const draft = await pendingDraft()
      const user = await createUser()

      const res = await request(appSending().app)
        .post(`/api/drafts/${String(draft.id)}/approve`)
        .set('Cookie', await sessionCookieFor(user.id))
        .send({ body: 'No version.' })

      expect(res.status).toBe(400)
    })

    test('the worker never rewrites a draft once it has been reviewed', async () => {
      // A follow-up after approval gets a draft of its own; the approved one
      // stays the record of what was sent.
      const draft = await pendingDraft()
      await approve(appSending().app, draft.id)

      await saveDraft(
        prisma,
        draft.ticketId,
        { category: 'refund', summary: 'Follow-up.', reply: 'A new draft' },
        'refund',
        'refund_approval',
      )

      const drafts = await prisma.replyDraft.findMany({
        where: { ticketId: draft.ticketId },
        orderBy: { id: 'asc' },
      })
      expect(drafts.map((d) => [d.status, d.body])).toEqual([
        ['approved', 'Your request has been passed to the team.'],
        ['pending', 'A new draft'],
      ])
    })
  })

  describe('2. a failed revert after a refused send', () => {
    let errors: string[] = []
    let restore: (() => void)[] = []
    afterEach(() => {
      for (const undo of restore) undo()
      restore = []
    })

    test('still answers 502, and logs both failures without the draft', async () => {
      const draft = await pendingDraft()
      errors = []
      const logged = spyOn(console, 'error').mockImplementation((line: unknown) => {
        errors.push(String(line))
      })
      // The claim goes through; the revert that follows the refused send
      // fails. The model delegate is a proxy a spy cannot patch, so the whole
      // property is swapped for one that counts its updateMany calls.
      const real = prisma.replyDraft
      let calls = 0
      const failingRevert = new Proxy(real, {
        get(target, key, receiver) {
          if (key !== 'updateMany') return Reflect.get(target, key, receiver)
          return (args: Parameters<typeof real.updateMany>[0]) => {
            calls += 1
            return calls === 2
              ? Promise.reject(new Error('connection lost'))
              : real.updateMany(args)
          }
        },
      })
      Object.defineProperty(prisma, 'replyDraft', { value: failingRevert, configurable: true })
      restore = [
        () => logged.mockRestore(),
        () => Object.defineProperty(prisma, 'replyDraft', { value: real, configurable: true }),
      ]

      const res = await approve(appSending({ fail: true }).app, draft.id, { body: 'Edited.' })

      expect(res.status).toBe(502)
      expect(errors).toEqual([
        `Draft ${String(draft.id)} not sent (EmailSendError: Resend refused the email: rate_limit_exceeded), and not returned to pending (Error: connection lost)`,
      ])
      expect(errors.join('\n')).not.toContain('Edited.')
    })
  })

  describe('3. state-changing requests from another origin', () => {
    const foreign = 'https://evil.helpdesk.example'

    test('a reject posted from a sibling page is refused, and the draft stays', async () => {
      const draft = await pendingDraft()
      const user = await createUser()

      const res = await request(appSending().app)
        .post(`/api/drafts/${String(draft.id)}/reject`)
        .set('Cookie', await sessionCookieFor(user.id))
        .set('Origin', foreign)

      expect(res.status).toBe(403)
      expect((await prisma.replyDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        'pending',
      )
    })

    test('a sign-out posted from a sibling page is refused, and the session stays', async () => {
      const user = await createUser()
      const cookie = await sessionCookieFor(user.id)

      const res = await request(appSending().app)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', foreign)

      expect(res.status).toBe(403)
      const me = await request(appSending().app).get('/api/auth/me').set('Cookie', cookie)
      expect(me.status).toBe(200)
    })

    test('the web app itself, and callers with no Origin, are let through', async () => {
      const first = await pendingDraft()
      const user = await createUser()
      const cookie = await sessionCookieFor(user.id)

      const fromApp = await request(appSending().app)
        .post(`/api/drafts/${String(first.id)}/reject`)
        .set('Cookie', cookie)
        .set('Origin', env.WEB_ORIGIN)
      expect(fromApp.status).toBe(200)

      // No Origin: a server, the scheduled workflow, a test. Its route's own
      // check still applies.
      const tasks = await request(appSending().app)
        .post('/api/tasks/cleanup-sessions')
        .set('Authorization', `Bearer ${env.TASKS_SECRET}`)
      expect(tasks.status).toBe(200)
    })

    test('reads are not refused: CORS already keeps their answers from other pages', async () => {
      const user = await createUser()

      const res = await request(appSending().app)
        .get('/api/drafts?status=pending')
        .set('Cookie', await sessionCookieFor(user.id))
        .set('Origin', foreign)

      expect(res.status).toBe(200)
    })
  })
})
