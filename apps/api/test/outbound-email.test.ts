import { describe, expect, test } from 'bun:test'
import type { CreateEmailOptions } from 'resend'
import { createEmailSender, EmailSendError, type EmailClient } from '../src/email/outbound.ts'

type SendResult = Awaited<ReturnType<EmailClient['emails']['send']>>

const from = 'Helpdesk Support <support@helpdesk.example.com>'
const email = { to: 'student@example.com', subject: 'Your ticket', text: 'Hello' }
const accepted: SendResult = { data: { id: 'resend-1' }, error: null, headers: null }

/**
 * A sender over a stand-in Resend client that records what it was asked to
 * send. Never the real client: a test that sent mail would need a live key and
 * a mailbox.
 */
function fakeSender(result: SendResult = accepted, sender = from) {
  const sent: CreateEmailOptions[] = []
  const client = {
    emails: {
      send: async (options: CreateEmailOptions) => {
        sent.push(options)
        return result
      },
    },
  } as unknown as EmailClient
  return { send: createEmailSender(client, sender), sent }
}

describe('sendEmail', () => {
  test('sends a plain-text email from the configured sender', async () => {
    const { send, sent } = fakeSender()

    await send(email)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ from, ...email })
  })

  test('returns the Message-ID it sent, on the sender domain', async () => {
    const { send, sent } = fakeSender()

    const result = await send(email)

    expect(result.resendId).toBe('resend-1')
    expect(result.messageId).toMatch(/^<[0-9a-f-]{36}@helpdesk\.example\.com>$/)
    expect(sent[0]?.headers?.['Message-ID']).toBe(result.messageId)
  })

  test('gives each email its own Message-ID', async () => {
    const { send } = fakeSender()

    const [first, second] = await Promise.all([send(email), send(email)])

    expect(first.messageId).not.toBe(second.messageId)
  })

  test('takes the domain from a bare address too', async () => {
    const { send } = fakeSender(accepted, 'support@helpdesk.example.com')

    const result = await send(email)

    expect(result.messageId).toEndWith('@helpdesk.example.com>')
  })

  test('starts a new thread without In-Reply-To or References', async () => {
    const { send, sent } = fakeSender()

    await send({ ...email, thread: [] })

    expect(sent[0]?.headers).not.toHaveProperty('In-Reply-To')
    expect(sent[0]?.headers).not.toHaveProperty('References')
  })

  test('replies to the last message and references the whole thread', async () => {
    const { send, sent } = fakeSender()

    await send({
      ...email,
      subject: 'Re: Your ticket',
      thread: ['<first@mail.example.com>', '<second@helpdesk.example.com>'],
    })

    expect(sent[0]?.headers).toMatchObject({
      'In-Reply-To': '<second@helpdesk.example.com>',
      References: '<first@mail.example.com> <second@helpdesk.example.com>',
    })
  })

  test('throws when Resend refuses the email', async () => {
    const { send } = fakeSender({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field', statusCode: 422 },
      headers: null,
    } as SendResult)

    const result = send({ ...email, to: 'not-an-address' })

    await expect(result).rejects.toBeInstanceOf(EmailSendError)
    await expect(result).rejects.toThrow('validation_error')
  })
})
