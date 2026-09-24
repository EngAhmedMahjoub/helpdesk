import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { env } from '../src/env.ts'

const app = createApp()

// Shaped like Resend's email.received event. Pretty-printed on purpose: the
// signature covers these exact bytes, so a route that parsed and re-serialised
// the JSON would fail to verify it.
const event = JSON.stringify(
  {
    type: 'email.received',
    created_at: '2026-09-24T08:00:00.000Z',
    data: {
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      from: 'maya@uni.edu',
      to: ['support@helpdesk.example.com'],
      message_id: '<first@mail.uni.edu>',
      subject: 'Cannot log in',
    },
  },
  null,
  2,
)

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

describe('POST /api/webhooks/resend', () => {
  test('accepts a correctly signed event, with no session', async () => {
    const res = await deliver(event, signed(event))

    expect(res.status).toBe(204)
  })

  test('verifies the raw body whatever the Content-Type says', async () => {
    const res = await deliver(event, signed(event), 'text/plain')

    expect(res.status).toBe(204)
  })

  test('refuses an unsigned request with 401', async () => {
    const res = await deliver(event, {})

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
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
    const tampered = event.replace('maya@uni.edu', 'attacker@evil.test')

    const res = await deliver(tampered, signed(event))

    expect(res.status).toBe(401)
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
