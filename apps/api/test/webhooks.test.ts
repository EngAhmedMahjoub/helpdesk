import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import type { ReceivedEmail } from '../src/email/inbound.ts'
import { EmailFetchError } from '../src/email/receiving.ts'
import { createBoss } from '../src/jobs/boss.ts'
import {
  PROCESS_TICKET,
  PROCESS_TICKET_RETRIES,
  type ProcessTicketJob,
  type QueueProcessTicket,
  createQueues,
  processTicketQueue,
} from '../src/jobs/process-ticket.ts'
import { AUTO_CLOSE_AFTER_MS, statusChange } from '../src/tickets/status.ts'
import { env } from '../src/env.ts'
import { prisma, resetDatabase } from './db.ts'
import { fakeSender } from './email-stub.ts'
import { createMessage, createTicket } from './fixtures.ts'
import bounce from './payloads/resend/bounce.json'
import newEmail from './payloads/resend/new-email.json'
import outOfOffice from './payloads/resend/out-of-office.json'
import replyOneReference from './payloads/resend/reply-one-reference.json'
import replySeveralReferences from './payloads/resend/reply-several-references.json'

const saved = newEmail as ReceivedEmail

// Stands in for Resend's received-emails API: the emails it holds by id, and
// the ids it was asked for. With `fetchFails` set it answers as Resend does
// when it cannot return one.
const inbox = new Map<string, ReceivedEmail>()
const fetched: string[] = []
let fetchFails = false

const fetchReceivedEmail = async (emailId: string) => {
  fetched.push(emailId)
  const email = inbox.get(emailId)
  if (fetchFails || !email) throw new EmailFetchError('Resend did not return the email: not_found')
  return email
}

// A real pg-boss on the test database, not a fake: the point of queuing inside
// the save's transaction is what the database does with it, so the tests read
// pg-boss's own job table.
const boss = createBoss()

/** The app as src/index.ts builds it, with Resend faked; `queue` swaps the job queue. */
const appWith = (queue: QueueProcessTicket = processTicketQueue(boss)) =>
  createApp({
    fetchReceivedEmail,
    sendEmail: fakeSender().sendEmail,
    queueProcessTicket: queue,
  })

const app = appWith()

/** The process-ticket jobs pg-boss holds, oldest first. */
async function queuedJobs(): Promise<ProcessTicketJob[]> {
  const rows = await prisma.$queryRaw<{ data: ProcessTicketJob }[]>`
    SELECT data FROM pgboss.job WHERE name = ${PROCESS_TICKET} ORDER BY created_on, id
  `
  return rows.map((row) => row.data)
}

beforeAll(async () => {
  await boss.start()
  await createQueues(boss)
})

afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 5_000 })
})

beforeEach(async () => {
  await resetDatabase()
  // resetDatabase leaves the pgboss schema alone.
  await boss.deleteAllJobs(PROCESS_TICKET)
  inbox.clear()
  inbox.set(saved.id, saved)
  fetched.length = 0
  fetchFails = false
})

/** Puts an email in the fake inbox under a new id, starting from the saved one. */
function receive(overrides: Partial<ReceivedEmail>): string {
  const id = crypto.randomUUID()
  inbox.set(id, { ...saved, ...overrides, id })
  return id
}

/**
 * An event as Resend sends it. Pretty-printed on purpose: the signature covers
 * these exact bytes, so a route that parsed and re-serialised the JSON would
 * fail to verify it.
 */
function eventFor(emailId = saved.id, type = 'email.received') {
  return JSON.stringify(
    {
      type,
      created_at: '2026-09-24T08:00:00.000Z',
      data: { email_id: emailId, from: saved.from, to: saved.to, subject: saved.subject },
    },
    null,
    2,
  )
}

const event = eventFor()

const now = () => Math.floor(Date.now() / 1000)

/**
 * Signs a payload the way Resend does (the Standard Webhooks scheme): HMAC-SHA256
 * over `id.timestamp.payload`, keyed with the base64 secret after `whsec_`.
 * Written out rather than borrowed from the SDK, so the SDK is not checking its
 * own signatures.
 */
function signed(
  payload: string,
  { id = 'msg_1', timestamp = now(), secret = env.RESEND_WEBHOOK_SECRET } = {},
) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', key)
    .update(`${id}.${String(timestamp)}.${payload}`)
    .digest('base64')
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  }
}

const deliver = (payload: string, headers: Record<string, string>, type = 'application/json') =>
  request(app).post('/api/webhooks/resend').set('Content-Type', type).set(headers).send(payload)

const deliverSigned = (payload = event, svixId = 'msg_1') =>
  deliver(payload, signed(payload, { id: svixId }))

describe('POST /api/webhooks/resend: signature', () => {
  test('accepts a correctly signed event, with no session', async () => {
    const res = await deliverSigned()

    expect(res.status).toBe(204)
  })

  test('verifies the raw body whatever the Content-Type says', async () => {
    const res = await deliver(event, signed(event), 'text/plain')

    expect(res.status).toBe(204)
  })

  test('refuses an unsigned request with 401, reading and saving nothing', async () => {
    const res = await deliver(event, {})

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
    expect(fetched).toHaveLength(0)
    expect(await prisma.ticket.count()).toBe(0)
  })

  test.each(['svix-id', 'svix-timestamp', 'svix-signature'])(
    'refuses a request missing %s',
    async (header) => {
      const headers: Record<string, string> = signed(event)
      delete headers[header]

      const res = await deliver(event, headers)

      expect(res.status).toBe(401)
    },
  )

  test('refuses a body changed after signing', async () => {
    const tampered = event.replace(saved.id, receive({}))

    const res = await deliver(tampered, signed(event))

    expect(res.status).toBe(401)
    expect(fetched).toHaveLength(0)
  })

  test('refuses a signature made with another secret', async () => {
    const res = await deliver(event, signed(event, { secret: 'whsec_b3RoZXItc2VjcmV0' }))

    expect(res.status).toBe(401)
  })

  test('refuses a signed request replayed ten minutes later', async () => {
    const res = await deliver(event, signed(event, { timestamp: now() - 10 * 60 }))

    expect(res.status).toBe(401)
  })

  test('refuses a signature for another message id', async () => {
    const headers = { ...signed(event, { id: 'msg_1' }), 'svix-id': 'msg_2' }

    const res = await deliver(event, headers)

    expect(res.status).toBe(401)
  })
})

describe('POST /api/webhooks/resend: inbound email', () => {
  describe('records whether a new ticket passed DMARC (#239)', () => {
    const withVerdict = (verdict: string) => {
      const auth = saved.headers?.['authentication-results'] ?? ''
      return receive({
        headers: {
          ...saved.headers,
          'authentication-results': auth.replace('dmarc=pass', verdict),
        },
      })
    }

    test('verified when it passed', async () => {
      await deliverSigned()

      expect((await prisma.ticket.findFirstOrThrow()).senderVerified).toBe(true)
    })

    test.each(['dmarc=fail', 'dmarc=none'])('unverified on %s', async (verdict) => {
      await deliverSigned(eventFor(withVerdict(verdict)))

      expect((await prisma.ticket.findFirstOrThrow()).senderVerified).toBe(false)
    })
  })

  test('saves a new email as a ticket holding it as the first message', async () => {
    await deliverSigned()

    expect(fetched).toEqual([saved.id])
    const tickets = await prisma.ticket.findMany({ include: { messages: true } })
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      subject: 'Cannot log in',
      studentEmail: 'maya.chen@uni.edu',
      studentName: 'Maya Chen',
      status: 'open',
    })
    expect(tickets[0]?.messages).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        author: 'student',
        agentId: null,
        body: 'I reset my password but the portal still says it is wrong.',
        emailMessageId: '<CAMaya01first@mail.gmail.com>',
      }),
    ])
  })

  test('saves one message when the same payload is posted twice', async () => {
    const first = await deliverSigned()
    const second = await deliverSigned()

    // Both acknowledged, or Resend would keep redelivering the duplicate.
    expect([first.status, second.status]).toEqual([204, 204])
    expect(await prisma.message.count()).toBe(1)
    expect(await prisma.ticket.count()).toBe(1)
  })

  test('saves one message when two events carry the same Message-ID', async () => {
    const again = receive({})

    await deliverSigned(eventFor(saved.id), 'msg_1')
    await deliverSigned(eventFor(again), 'msg_2')

    expect(fetched).toEqual([saved.id, again])
    expect(await prisma.message.count()).toBe(1)
  })

  test('saves one message when the same email arrives twice at once', async () => {
    const again = receive({})

    const statuses = await Promise.all([
      deliverSigned(eventFor(saved.id), 'msg_1'),
      deliverSigned(eventFor(again), 'msg_2'),
    ])

    expect(statuses.map((res) => res.status)).toEqual([204, 204])
    expect(await prisma.message.count()).toBe(1)
    // The ticket and its message are one insert: the loser leaves no empty ticket.
    expect(await prisma.ticket.count()).toBe(1)
  })

  test('saves every email that has no Message-ID, since none can be told apart', async () => {
    const first = receive({ message_id: '' })
    const second = receive({ message_id: '' })

    await deliverSigned(eventFor(first), 'msg_1')
    await deliverSigned(eventFor(second), 'msg_2')

    const messages = await prisma.message.findMany()
    expect(messages).toHaveLength(2)
    expect(messages.map((message) => message.emailMessageId)).toEqual([null, null])
  })

  test('saves emails with different Message-IDs as separate tickets', async () => {
    const other = receive({ message_id: '<CAMaya99other@mail.gmail.com>' })

    await deliverSigned(eventFor(saved.id), 'msg_1')
    await deliverSigned(eventFor(other), 'msg_2')

    expect(await prisma.ticket.count()).toBe(2)
  })

  test.each([
    ['an out-of-office reply', outOfOffice],
    ['a bounce', bounce],
  ])('acknowledges %s and saves nothing', async (_, payload) => {
    const emailId = receive(payload as ReceivedEmail)

    const res = await deliverSigned(eventFor(emailId))

    // Acknowledged, or Resend would keep delivering it.
    expect(res.status).toBe(204)
    expect(await prisma.ticket.count()).toBe(0)
    expect(await prisma.message.count()).toBe(0)
  })

  describe('input that used to make saving throw (#210)', () => {
    test('saves an email whose long non-ASCII Message-ID would overflow the unique index', async () => {
      // 998 such characters made a 3008-byte index row, over btree's 2704-byte
      // limit, so the insert failed on every redelivery.
      const res = await deliverSigned(eventFor(receive({ message_id: `<${'文'.repeat(996)}>` })))

      expect(res.status).toBe(204)
      const message = await prisma.message.findFirstOrThrow()
      expect(message.emailMessageId).toBeNull()
    })

    test('saves an email with a NUL in its subject, name and text', async () => {
      const res = await deliverSigned(
        eventFor(
          receive({
            subject: 'Cannot\u0000 log in',
            text: 'Help\u0000 me',
            headers: { ...saved.headers, from: 'Maya\u0000 Chen <maya.chen@uni.edu>' },
          }),
        ),
      )

      expect(res.status).toBe(204)
      const ticket = await prisma.ticket.findFirstOrThrow({ include: { messages: true } })
      expect(ticket).toMatchObject({ subject: 'Cannot log in', studentName: 'Maya Chen' })
      expect(ticket.messages[0]?.body).toBe('Help me')
    })

    test('saves an email that lacks a Subject or Message-ID', async () => {
      const res = await deliverSigned(
        eventFor(receive({ subject: null, message_id: null } as unknown as ReceivedEmail)),
      )

      expect(res.status).toBe(204)
      const ticket = await prisma.ticket.findFirstOrThrow({ include: { messages: true } })
      expect(ticket.subject).toBe('(no subject)')
      expect(ticket.messages[0]?.emailMessageId).toBeNull()
    })

    test('stores a Message-ID carrying a CR/LF as none, so it never reaches a reply', async () => {
      await deliverSigned(eventFor(receive({ message_id: '<x@y>\r\nBcc: attacker@evil.test' })))

      const message = await prisma.message.findFirstOrThrow()
      expect(message.emailMessageId).toBeNull()
    })
  })

  test('acknowledges other events without reading or saving anything', async () => {
    const res = await deliverSigned(eventFor(saved.id, 'email.delivered'))

    expect(res.status).toBe(204)
    expect(fetched).toHaveLength(0)
    expect(await prisma.ticket.count()).toBe(0)
  })

  test('acknowledges an email from an unusable sender and saves nothing', async () => {
    const res = await deliverSigned(eventFor(receive({ from: 'not-an-address' })))

    expect(res.status).toBe(204)
    expect(await prisma.ticket.count()).toBe(0)
  })

  test('answers 502 and saves nothing when Resend cannot return the email', async () => {
    fetchFails = true

    const res = await deliverSigned()

    // Not acknowledged, so Resend delivers the event again later.
    expect(res.status).toBe(502)
    expect(await prisma.ticket.count()).toBe(0)
  })
})

describe('POST /api/webhooks/resend: process-ticket jobs', () => {
  test('queues a job for a new email, naming its ticket and message', async () => {
    await deliverSigned()

    const message = await prisma.message.findFirstOrThrow()
    expect(await queuedJobs()).toEqual([{ ticketId: message.ticketId, messageId: message.id }])
  })

  test('the job carries the retry policy (5.15)', async () => {
    // A job copies its queue's policy when queued, so this reads the policy
    // the queue holds after createQueues, whether it made the queue or found it.
    await deliverSigned()

    const rows = await prisma.$queryRaw<
      { retryLimit: number; retryDelay: number; retryBackoff: boolean }[]
    >`
      SELECT retry_limit AS "retryLimit", retry_delay AS "retryDelay",
             retry_backoff AS "retryBackoff"
      FROM pgboss.job WHERE name = ${PROCESS_TICKET}
    `
    expect(rows).toEqual([PROCESS_TICKET_RETRIES])
  })

  test('queues a job for a reply appended to its ticket', async () => {
    await deliverSigned(eventFor(saved.id), 'msg_open')
    const reply = receive(replyOneReference as ReceivedEmail)

    await deliverSigned(eventFor(reply), 'msg_reply')

    const messages = await prisma.message.findMany({ orderBy: { id: 'asc' } })
    // Both on the one ticket: the reply was appended, not given a ticket of its own.
    expect(new Set(messages.map((m) => m.ticketId)).size).toBe(1)
    expect(await queuedJobs()).toEqual(
      messages.map((m) => ({ ticketId: m.ticketId, messageId: m.id })),
    )
  })

  test('queues one job when the same email is delivered twice, or twice at once', async () => {
    await deliverSigned()
    await deliverSigned()
    const again = receive({})
    await Promise.all([
      deliverSigned(eventFor(saved.id), 'msg_a'),
      deliverSigned(eventFor(again), 'msg_b'),
    ])

    expect(await prisma.message.count()).toBe(1)
    expect(await queuedJobs()).toHaveLength(1)
  })

  test.each([
    [
      'an out-of-office reply',
      () => deliverSigned(eventFor(receive(outOfOffice as ReceivedEmail))),
    ],
    ['a refused sender', () => deliverSigned(eventFor(receive({ from: 'not-an-address' })))],
    ['another event type', () => deliverSigned(eventFor(saved.id, 'email.delivered'))],
  ])('queues nothing for %s', async (_, deliverIt) => {
    await deliverIt()

    expect(await queuedJobs()).toHaveLength(0)
  })

  test('saves nothing and queues nothing when the transaction fails after queuing', async () => {
    // The job goes into the table, then the transaction fails: both must go.
    const failing = appWith(async (job, tx) => {
      await processTicketQueue(boss)(job, tx)
      throw new Error('failed after queuing')
    })
    const body = eventFor()

    const res = await request(failing)
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set(signed(body))
      .send(body)

    // Not acknowledged, so Resend redelivers, and the redelivery is no duplicate.
    expect(res.status).toBe(500)
    expect(await prisma.ticket.count()).toBe(0)
    expect(await queuedJobs()).toHaveLength(0)
  })

  test('fails the delivery, saving nothing, when the app was given no job queue', async () => {
    const body = eventFor()
    const res = await request(createApp({ fetchReceivedEmail, sendEmail: fakeSender().sendEmail }))
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set(signed(body))
      .send(body)

    expect(res.status).toBe(500)
    expect(await prisma.ticket.count()).toBe(0)
  })
})

describe('POST /api/webhooks/resend: new tickets per sender (5.2b)', () => {
  /** Delivers a new email, a fresh Message-ID each, from `from`. */
  const deliverNew = (n: number, from = saved.from) =>
    deliverSigned(
      eventFor(receive({ from, message_id: `<new${String(n)}@mail.uni.edu>` })),
      `msg_new_${String(n)}`,
    )

  test('opens at most 4 tickets an hour for one sender, acknowledging the rest', async () => {
    const statuses = []
    for (const n of [1, 2, 3, 4, 5, 6]) statuses.push((await deliverNew(n)).status)

    // Acknowledged all the same, or Resend would keep redelivering the capped ones.
    expect(statuses).toEqual([204, 204, 204, 204, 204, 204])
    expect(await prisma.ticket.count()).toBe(4)
    expect(await queuedJobs()).toHaveLength(4)
  })

  test('counts the sender whatever the case of their address', async () => {
    for (const n of [1, 2, 3, 4]) await deliverNew(n)

    await deliverNew(5, 'MAYA.Chen@Uni.EDU')

    expect(await prisma.ticket.count()).toBe(4)
  })

  test("does not count another sender's tickets", async () => {
    for (const n of [1, 2, 3, 4]) await deliverNew(n)

    await deliverNew(5, 'sam.lee@uni.edu')

    expect(await prisma.ticket.count({ where: { studentEmail: 'sam.lee@uni.edu' } })).toBe(1)
  })

  test('counts only the last hour', async () => {
    for (const n of [1, 2, 3, 4]) await deliverNew(n)
    // Opened an hour and a minute ago: out of the window.
    await prisma.ticket.updateMany({ data: { createdAt: new Date(Date.now() - 61 * 60 * 1000) } })

    await deliverNew(5)

    expect(await prisma.ticket.count()).toBe(5)
  })

  test('still appends a reply to a ticket the sender has, once capped', async () => {
    // The opening email the saved reply answers, then three more new tickets.
    await deliverSigned(eventFor(saved.id), 'msg_open')
    for (const n of [1, 2, 3]) await deliverNew(n)
    await deliverNew(4)
    expect(await prisma.ticket.count()).toBe(4)

    await deliverSigned(eventFor(receive(replyOneReference as ReceivedEmail)), 'msg_reply')

    const opening = await prisma.message.findFirstOrThrow({
      where: { emailMessageId: '<CAMaya01first@mail.gmail.com>' },
    })
    expect(await prisma.message.count({ where: { ticketId: opening.ticketId } })).toBe(2)
    expect(await prisma.ticket.count()).toBe(4)
  })
})

describe('POST /api/webhooks/resend: threading', () => {
  // The saved new email is Maya's opening message, <CAMaya01first@mail.gmail.com>.
  // Her replies name it in In-Reply-To or References, as Gmail wrote them.
  const replyOne = replyOneReference as ReceivedEmail
  const replySeveral = replySeveralReferences as ReceivedEmail

  /** Delivers the opening email and answers the ticket it made. */
  async function opened() {
    await deliverSigned(eventFor(saved.id), 'msg_open')
    return prisma.ticket.findFirstOrThrow({ include: { messages: true } })
  }

  const deliverReply = (reply: Partial<ReceivedEmail>, svixId = 'msg_reply') =>
    deliverSigned(eventFor(receive(reply)), svixId)

  test("appends a student's reply to the original ticket", async () => {
    const ticket = await opened()

    const res = await deliverReply(replyOne)

    expect(res.status).toBe(204)
    expect(await prisma.ticket.count()).toBe(1)
    const thread = await prisma.message.findMany({
      where: { ticketId: ticket.id },
      orderBy: { id: 'asc' },
    })
    expect(thread.map((message) => [message.author, message.emailMessageId])).toEqual([
      ['student', '<CAMaya01first@mail.gmail.com>'],
      ['student', '<CAMaya02second@mail.gmail.com>'],
    ])
    expect(thread[1]?.body).toStartWith('It happens on my phone too.')
  })

  test('matches a reply to our email through References, since its In-Reply-To names our reply', async () => {
    // In-Reply-To is the Message-ID Amazon SES gave our reply, which nothing
    // stores; only References still names Maya's opening email.
    const ticket = await opened()

    await deliverReply(replySeveral)

    expect(await prisma.ticket.count()).toBe(1)
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
  })

  test('matches on In-Reply-To alone when a client sends no References', async () => {
    const ticket = await opened()
    const { references: _, ...headers } = replyOne.headers ?? {}

    await deliverReply({ ...replyOne, headers })

    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
  })

  test("leaves the ticket's subject and status alone and moves its updatedAt", async () => {
    const ticket = await opened()
    const before = new Date(Date.UTC(2026, 0, 1))
    await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: before } })

    await deliverReply({ ...replyOne, subject: 'Re: Cannot log in (still broken!)' })

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(after.subject).toBe('Cannot log in')
    expect(after.status).toBe('open')
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime())
  })

  describe('on a Resolved or Closed ticket', () => {
    const longAgo = new Date(Date.UTC(2026, 0, 1))

    test('keeps a Resolved ticket Resolved and starts its auto-close timer over', async () => {
      const ticket = await opened()
      // Resolved long ago, so the timer is nearly out.
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: statusChange('resolved', longAgo),
      })

      const before = Date.now()
      await deliverReply(replyOne)
      const after = Date.now()

      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      expect(stored.status).toBe('resolved')
      const timer = stored.autoCloseAt?.getTime() ?? 0
      expect(timer).toBeGreaterThanOrEqual(before + AUTO_CLOSE_AFTER_MS)
      expect(timer).toBeLessThanOrEqual(after + AUTO_CLOSE_AFTER_MS)
      expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
    })

    test('keeps a Closed ticket Closed, with no timer', async () => {
      const ticket = await opened()
      await prisma.ticket.update({ where: { id: ticket.id }, data: statusChange('closed') })

      await deliverReply(replyOne)

      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      expect(stored.status).toBe('closed')
      expect(stored.autoCloseAt).toBeNull()
      expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
    })

    test('keeps an Open ticket Open, with no timer', async () => {
      const ticket = await opened()

      await deliverReply(replyOne)

      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      expect(stored.status).toBe('open')
      expect(stored.autoCloseAt).toBeNull()
    })

    test('resets no timer when the reply is a duplicate', async () => {
      const ticket = await opened()
      const emailId = receive(replyOne)
      await deliverSigned(eventFor(emailId), 'msg_reply')
      const resolved = statusChange('resolved', longAgo)
      await prisma.ticket.update({ where: { id: ticket.id }, data: resolved })

      await deliverSigned(eventFor(emailId), 'msg_reply')

      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      expect(stored.autoCloseAt).toEqual(resolved.autoCloseAt)
    })
  })

  describe('only after a DMARC pass (5.2a)', () => {
    /** The saved reply with SES's verdict replaced, or its Authentication-Results removed. */
    const replyWithDmarc = (dmarc: string | undefined) => {
      const { 'authentication-results': auth, ...headers } = replyOne.headers ?? {}
      return {
        ...replyOne,
        headers:
          dmarc === undefined
            ? headers
            : { ...headers, 'authentication-results': (auth ?? '').replace('dmarc=pass', dmarc) },
      }
    }

    test('appends a reply that passed DMARC', async () => {
      const ticket = await opened()

      await deliverReply(replyWithDmarc('dmarc=pass'))

      expect(await prisma.ticket.count()).toBe(1)
      expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
    })

    test.each([
      ['failed DMARC', 'dmarc=fail'],
      ['has no DMARC verdict, from a domain without a policy', 'dmarc=none'],
      ['carries no Authentication-Results', undefined],
    ])('opens a new ticket for a reply that %s, rather than append it', async (_, dmarc) => {
      const ticket = await opened()

      const res = await deliverReply(replyWithDmarc(dmarc))

      // Acknowledged and saved, just not on the student's ticket.
      expect(res.status).toBe(204)
      expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(1)
      const other = await prisma.ticket.findFirstOrThrow({ where: { NOT: { id: ticket.id } } })
      expect(other.studentEmail).toBe('maya.chen@uni.edu')
      // Nor will the AI email it: the sender is unverified (#239).
      expect(other.senderVerified).toBe(false)
    })
  })

  test('starts a new ticket when the IDs match nothing stored', async () => {
    await opened()
    const headers = {
      ...replyOne.headers,
      'in-reply-to': '<unknown@mail.gmail.com>',
      references: '<unknown@mail.gmail.com>',
    }

    await deliverReply({ ...replyOne, headers })

    expect(await prisma.ticket.count()).toBe(2)
  })

  test("starts a new ticket when someone else replies with the thread's IDs", async () => {
    // Copied on the thread, they have seen its Message-IDs, but may not write
    // into Maya's ticket.
    const ticket = await opened()
    const headers = { ...replyOne.headers, from: 'Sam Lee <sam.lee@uni.edu>' }

    await deliverReply({ ...replyOne, from: 'sam.lee@uni.edu', headers })

    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(1)
    const other = await prisma.ticket.findFirstOrThrow({ where: { NOT: { id: ticket.id } } })
    expect(other.studentEmail).toBe('sam.lee@uni.edu')
  })

  test("matches the student's address whatever its case", async () => {
    const ticket = await opened()

    await deliverReply({ ...replyOne, from: 'Maya.Chen@UNI.edu' })

    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
  })

  test('appends a redelivered reply once', async () => {
    const ticket = await opened()
    const emailId = receive(replyOne)

    await deliverSigned(eventFor(emailId), 'msg_reply')
    await deliverSigned(eventFor(emailId), 'msg_reply')

    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
  })

  test('picks the ticket the email answers most directly when its IDs reach two', async () => {
    // Maya's opening email is on one ticket and her second message, somehow, on
    // another. References names both; the nearer one, the second, wins.
    const first = await opened()
    const second = await createTicket({
      subject: 'Another question',
      studentEmail: 'maya.chen@uni.edu',
    })
    await createMessage({ ticketId: second.id, emailMessageId: '<CAMaya02second@mail.gmail.com>' })

    await deliverReply(replySeveral)

    expect(await prisma.message.count({ where: { ticketId: second.id } })).toBe(2)
    expect(await prisma.message.count({ where: { ticketId: first.id } })).toBe(1)
  })

  test('still finds the opening email at the start of a References thousands long', async () => {
    const ticket = await opened()
    const filler = Array.from({ length: 5_000 }, (_, i) => `"<filler${String(i)}@mail>"`)
    const headers = {
      ...replyOne.headers,
      'in-reply-to': '<filler4999@mail>',
      references: `["<CAMaya01first@mail.gmail.com>",${filler.join(',')}]`,
    }

    const res = await deliverReply({ ...replyOne, headers })

    expect(res.status).toBe(204)
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(2)
  })
})
