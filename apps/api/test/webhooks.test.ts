import { beforeEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import type { ReceivedEmail } from '../src/email/inbound.ts'
import { EmailFetchError } from '../src/email/receiving.ts'
import { env } from '../src/env.ts'
import { prisma, resetDatabase } from './db.ts'
import newEmail from './payloads/resend/new-email.json'

const saved = newEmail as ReceivedEmail

// Stands in for Resend's received-emails API: the emails it holds by id, and
// the ids it was asked for. With `fetchFails` set it answers as Resend does
// when it cannot return one.
const inbox = new Map<string, ReceivedEmail>()
const fetched: string[] = []
let fetchFails = false

const app = createApp({
  fetchReceivedEmail: async (emailId) => {
    fetched.push(emailId)
    const email = inbox.get(emailId)
    if (fetchFails || !email)
      throw new EmailFetchError('Resend did not return the email: not_found')
    return email
  },
  sendEmail: async () => ({ resendId: null }),
})

beforeEach(async () => {
  await resetDatabase()
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
