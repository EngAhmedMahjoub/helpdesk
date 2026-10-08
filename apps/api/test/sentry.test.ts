import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as Sentry from '@sentry/bun'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { initSentry, scrubEvent } from '../src/sentry.ts'
import { resetDatabase } from './db.ts'
import { createTicket, createUser, sessionCookieFor } from './fixtures.ts'

// The real SDK with its transport swapped for one that keeps what it would
// have sent, so the assertions see the envelope Sentry would receive, after
// every integration and scrubEvent have had their say. Nothing leaves the
// process: the DSN is well formed and points nowhere it is ever sent.
const sent: string[] = []

const memoryTransport: Parameters<typeof initSentry>[0]['transport'] = (options) =>
  Sentry.createTransport(options, async (req) => {
    sent.push(typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body))
    return { statusCode: 200 }
  })

/** The error events among what was sent; sessions and client reports are left out. */
function sentEvents(): Sentry.ErrorEvent[] {
  return sent.flatMap((envelope) => {
    const lines = envelope.split('\n')
    return lines.flatMap((line, i) => {
      const header = JSON.parse(line || 'null') as { type?: string } | null
      return header?.type === 'event' ? [JSON.parse(lines[i + 1]!) as Sentry.ErrorEvent] : []
    })
  })
}

beforeAll(() => {
  initSentry({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    environment: 'test',
    release: 'test-release',
    transport: memoryTransport,
  })
})

// bun test runs every file in one process: the client must not outlive this one.
afterAll(async () => {
  await Sentry.close()
})

beforeEach(async () => {
  sent.length = 0
  await resetDatabase()
})

describe('errors reported to Sentry', () => {
  test('a 500 is reported, without the body, cookie or headers of its request', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    const cookie = await sessionCookieFor((await createUser()).id)
    const ticket = await createTicket()
    // Random, so neither can match the test's own source, which Sentry quotes
    // around each stack frame.
    const words = `Words only the student should read ${crypto.randomUUID()}`
    const token = crypto.randomUUID()
    const broken = createApp({
      sendEmail: () => Promise.reject(new TypeError('bad address object')),
    })

    try {
      const res = await request(broken)
        .post(`/api/tickets/${String(ticket.id)}/replies?token=${token}`)
        .set('Cookie', cookie)
        .send({ body: words })
      expect(res.status).toBe(500)
      await Sentry.flush(2_000)
    } finally {
      quiet.mockRestore()
    }

    const events = sentEvents()
    expect(events).toHaveLength(1)
    expect(events[0]!.exception?.values?.[0]).toMatchObject({
      type: 'TypeError',
      value: 'bad address object',
    })
    expect(events[0]).toMatchObject({ environment: 'test', release: 'test-release' })
    expect(events[0]!.request).toEqual({
      method: 'POST',
      url: expect.stringMatching(new RegExp(`/api/tickets/${String(ticket.id)}/replies$`)),
    })

    const raw = sent.join('\n')
    expect(raw).not.toContain(words)
    expect(raw).not.toContain(cookie.split('=')[1]!)
    expect(raw).not.toContain(token)
  })

  test('a 4xx is not reported, and its body goes nowhere', async () => {
    const quiet = spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // Cut short mid-password: unparseable, so the error handler's 400.
      const res = await request(createApp())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":"a@example.com","password":"cleartext-secret')
      expect(res.status).toBe(400)
      await Sentry.flush(2_000)
    } finally {
      quiet.mockRestore()
    }

    expect(sentEvents()).toHaveLength(0)
    expect(sent.join('\n')).not.toContain('cleartext-secret')
  })
})

describe('scrubEvent', () => {
  test("replaces a Prisma error's message, which quotes the query's arguments", () => {
    const event = scrubEvent({
      type: undefined,
      exception: {
        values: [
          { type: 'PrismaClientValidationError', value: 'Argument body: "Dear student, ..."' },
          { type: 'TypeError', value: 'x is not a function' },
        ],
      },
    })

    expect(event.exception?.values?.map((e) => e.value)).toEqual([
      '[redacted: Prisma messages quote the query arguments]',
      'x is not a function',
    ])
  })

  test("tags an error's code, so a redacted Prisma error still says which failure", () => {
    const error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

    expect(scrubEvent({ type: undefined }, { originalException: error }).tags).toEqual({
      code: 'P2002',
    })
  })
})
