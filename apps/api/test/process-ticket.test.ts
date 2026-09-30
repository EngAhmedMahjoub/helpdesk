import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { JobWithMetadata } from 'pg-boss'
import type { AiOutput, TicketDetail } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { AiFailure } from '../src/ai/failure.ts'
import { EmailSendError, type OutboundEmail } from '../src/email/outbound.ts'
import {
  type ProcessTicketJob,
  processTicket,
  processTicketWorker,
} from '../src/jobs/process-ticket.ts'
import { message, stubAnthropic } from './ai-stub.ts'
import { prisma, resetDatabase } from './db.ts'
import { createMessage, createTicket, createUser, sessionCookieFor } from './fixtures.ts'

beforeEach(resetDatabase)

const DAY = 24 * 60 * 60 * 1000

const technical: AiOutput = {
  category: 'technical',
  summary: 'Week 2 videos will not load in Safari.',
  reply: 'Allow auto-play for the site in Safari settings, then reload the lesson.',
}

const refund: AiOutput = {
  category: 'refund',
  summary: 'Wants a refund after withdrawing in week 1.',
  reply: 'Your refund request has been passed to the team.',
}

/** A stand-in client that answers every request with `output`. */
const answering = (output: AiOutput) => stubAnthropic(() => message(JSON.stringify(output)))

/** Everything the worker needs, with the emails it sends recorded instead of sent. */
function depsFor(client: ReturnType<typeof stubAnthropic>['client'], { failSend = false } = {}) {
  const emails: OutboundEmail[] = []
  return {
    emails,
    deps: {
      prisma,
      client,
      knowledgeBase: '<article file="refunds.md" category="refund">Refunds.</article>',
      sendEmail: async (email: OutboundEmail) => {
        if (failSend) throw new EmailSendError('Resend refused the email: rate_limit_exceeded')
        emails.push(email)
        return { resendId: 'resend-id' }
      },
    },
  }
}

/** A ticket from a real-looking student, with their first email carrying a Message-ID. */
async function ticketWithEmail(body: string, overrides: Parameters<typeof createTicket>[0] = {}) {
  const ticket = await createTicket({
    subject: 'Videos will not play',
    studentEmail: 'tom@uni.edu',
    category: null,
    summary: null,
    ...overrides,
  })
  // Unique per ticket: the column is, so two tickets cannot share one.
  const emailMessageId = `<${randomUUID()}@uni.edu>`
  const inbound = await createMessage({ ticketId: ticket.id, body, emailMessageId })
  return { ticket, emailMessageId, job: { ticketId: ticket.id, messageId: inbound.id } }
}

const stored = (id: number) => prisma.ticket.findUniqueOrThrow({ where: { id } })

describe('a general or technical ticket', () => {
  test('emails the reply to the student, threaded onto their email', async () => {
    const { job, emailMessageId } = await ticketWithEmail('Week 2 videos spin forever.')
    const { deps, emails } = depsFor(answering(technical).client)

    await processTicket(deps, job)

    expect(emails).toEqual([
      {
        to: 'tom@uni.edu',
        subject: 'Re: Videos will not play',
        text: technical.reply,
        thread: [emailMessageId],
      },
    ])
  })

  test('saves the reply as an AI message and resolves the ticket', async () => {
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const { deps } = depsFor(answering(technical).client)

    const before = Date.now()
    await processTicket(deps, job)

    const after = await stored(ticket.id)
    expect(after).toMatchObject({
      status: 'resolved',
      category: 'technical',
      summary: technical.summary,
      needsAgent: false,
    })
    // Resolved through statusChange, so the auto-close timer runs from now.
    expect(after.autoCloseAt!.getTime()).toBeGreaterThanOrEqual(before + 14 * DAY)
    const reply = await prisma.message.findFirstOrThrow({
      where: { ticketId: ticket.id, direction: 'outbound' },
    })
    expect(reply).toMatchObject({
      author: 'ai',
      agentId: null,
      body: technical.reply,
      emailMessageId: null,
    })
    expect(await prisma.replyDraft.count()).toBe(0)
  })

  test('a send Resend refuses saves nothing, and throws for pg-boss to retry', async () => {
    // Emailed before it is saved: the thread must never show a reply the
    // student did not receive.
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const { deps } = depsFor(answering(technical).client, { failSend: true })

    await expect(processTicket(deps, job)).rejects.toBeInstanceOf(EmailSendError)

    expect(await stored(ticket.id)).toMatchObject({ status: 'open', category: null })
    expect(await prisma.message.count({ where: { direction: 'outbound' } })).toBe(0)
  })

  test('the ticket detail shows the saved values and the AI reply', async () => {
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    await processTicket(depsFor(answering(technical).client).deps, job)
    const agent = await createUser()

    const res = await request(createApp())
      .get(`/api/tickets/${String(ticket.id)}`)
      .set('Cookie', await sessionCookieFor(agent.id))

    const detail = res.body as TicketDetail
    expect(detail).toMatchObject({
      status: 'resolved',
      category: 'technical',
      summary: technical.summary,
    })
    expect(detail.messages.map((m) => m.author)).toEqual(['student', 'ai'])
  })
})

describe('a refund ticket', () => {
  test('saves the reply as a pending draft, flags the ticket, and emails nothing', async () => {
    const { ticket, job } = await ticketWithEmail('I withdrew in week 1. Refund please.')
    const { deps, emails } = depsFor(answering(refund).client)

    await processTicket(deps, job)

    expect(emails).toHaveLength(0)
    expect(await stored(ticket.id)).toMatchObject({
      // Not resolved: nobody has answered the student yet.
      status: 'open',
      category: 'refund',
      summary: refund.summary,
      needsAgent: true,
      escalationReason: 'refund_approval',
    })
    expect(await prisma.replyDraft.findMany({ where: { ticketId: ticket.id } })).toMatchObject([
      { body: refund.reply, status: 'pending', reviewedById: null },
    ])
    expect(await prisma.message.count({ where: { direction: 'outbound' } })).toBe(0)
  })

  test('the safeguard sends "technical question, refund me" down this path too', async () => {
    // The model calls it technical; the student asked for money back.
    const { ticket, job } = await ticketWithEmail(
      'Nothing plays on Chrome either. Honestly, just refund me.',
    )
    const { deps, emails } = depsFor(answering({ ...technical, reply: 'Try Chrome.' }).client)

    await processTicket(deps, job)

    expect(emails).toHaveLength(0)
    expect(await stored(ticket.id)).toMatchObject({
      category: 'refund',
      needsAgent: true,
      escalationReason: 'refund_approval',
    })
    expect(await prisma.replyDraft.count({ where: { ticketId: ticket.id } })).toBe(1)
  })

  test('a follow-up replaces the pending draft rather than queuing a second', async () => {
    const { ticket, job } = await ticketWithEmail('Refund please.')
    await prisma.replyDraft.create({ data: { ticketId: ticket.id, body: 'Stale draft' } })
    const reviewer = await createUser()
    await prisma.replyDraft.create({
      data: {
        ticketId: ticket.id,
        body: 'An earlier draft, already rejected',
        status: 'rejected',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      },
    })

    await processTicket(depsFor(answering(refund).client).deps, job)

    const drafts = await prisma.replyDraft.findMany({
      where: { ticketId: ticket.id },
      orderBy: { id: 'asc' },
    })
    expect(drafts.map((draft) => [draft.status, draft.body])).toEqual([
      ['pending', refund.reply],
      // A reviewed draft is history, not something to overwrite.
      ['rejected', 'An earlier draft, already rejected'],
    ])
  })
})

describe.each(['resolved', 'closed'] as const)('a follow-up on a %s ticket', (status) => {
  // Last time's category and summary still on it, and a Resolved ticket's timer
  // well short of the 14 days a fresh resolve would give, so a reset shows.
  const autoCloseAt = status === 'resolved' ? new Date(Date.now() + 3 * DAY) : null
  const earlier = {
    status,
    autoCloseAt,
    category: 'general' as const,
    summary: 'Asked about deadlines.',
  }
  // Compared as numbers: Bun's toMatchObject counts any two Dates as equal.
  const timerOf = async (id: number) => (await stored(id)).autoCloseAt?.getTime() ?? null

  test('emails the reply and updates the summary, but the status stays', async () => {
    const { ticket, job } = await ticketWithEmail('Now the week 2 videos will not load.', earlier)
    const { deps, emails } = depsFor(answering(technical).client)

    await processTicket(deps, job)

    expect(emails.map((email) => email.text)).toEqual([technical.reply])
    expect(await timerOf(ticket.id)).toBe(autoCloseAt?.getTime() ?? null)
    expect(await stored(ticket.id)).toMatchObject({
      status,
      category: 'technical',
      summary: technical.summary,
      needsAgent: false,
    })
    const replies = await prisma.message.findMany({
      where: { ticketId: ticket.id, direction: 'outbound' },
    })
    expect(replies).toMatchObject([{ author: 'ai', body: technical.reply }])
  })

  test('a refund saves a draft and flags the ticket, but the status stays', async () => {
    const { ticket, job } = await ticketWithEmail('I withdrew in week 1. Refund please.', earlier)
    const { deps, emails } = depsFor(answering(refund).client)

    await processTicket(deps, job)

    expect(emails).toHaveLength(0)
    expect(await timerOf(ticket.id)).toBe(autoCloseAt?.getTime() ?? null)
    expect(await stored(ticket.id)).toMatchObject({
      status,
      category: 'refund',
      summary: refund.summary,
      needsAgent: true,
      escalationReason: 'refund_approval',
    })
    expect(await prisma.replyDraft.findMany({ where: { ticketId: ticket.id } })).toMatchObject([
      { body: refund.reply, status: 'pending' },
    ])
  })
})

test('a ticket closed while the model answered stays closed', async () => {
  // The status is read at the end, not with the thread: an agent's close wins.
  const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
  const { client } = stubAnthropic(async () => {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'closed' } })
    return message(JSON.stringify(technical))
  })

  await processTicket(depsFor(client).deps, job)

  expect(await stored(ticket.id)).toMatchObject({ status: 'closed', summary: technical.summary })
})

describe('either path', () => {
  test('sends the model the whole thread, oldest first', async () => {
    const ticket = await createTicket()
    // Inserted out of order, so the order sent is the query's, not insertion's.
    await createMessage({
      ticketId: ticket.id,
      body: 'Second message',
      createdAt: new Date('2026-09-02T09:00:00Z'),
    })
    const first = await createMessage({
      ticketId: ticket.id,
      body: 'First message',
      createdAt: new Date('2026-09-01T09:00:00Z'),
    })
    const { client, requests } = answering(technical)

    await processTicket(depsFor(client).deps, { ticketId: ticket.id, messageId: first.id })

    const sent = (requests[0]!.messages as { content: string }[])[0]!.content
    expect(sent.indexOf('First message')).toBeLessThan(sent.indexOf('Second message'))
  })

  test('a failed model call throws, emails nothing and changes nothing', async () => {
    const { ticket, job } = await ticketWithEmail('Help', {
      category: 'general',
      summary: 'Before',
    })
    const { deps, emails } = depsFor(stubAnthropic(() => message(null, 'refusal')).client)

    await expect(processTicket(deps, job)).rejects.toBeInstanceOf(AiFailure)

    expect(emails).toHaveLength(0)
    expect(await stored(ticket.id)).toMatchObject({
      status: 'open',
      category: 'general',
      summary: 'Before',
      needsAgent: false,
    })
    expect(await prisma.replyDraft.count()).toBe(0)
  })

  test('a ticket deleted before the job ran is skipped without asking the model', async () => {
    const { client, requests } = answering(technical)

    await processTicket(depsFor(client).deps, { ticketId: 999_999, messageId: 1 })

    expect(requests).toHaveLength(0)
  })

  test('a ticket deleted while the model answered is skipped, not retried', async () => {
    const { ticket, job } = await ticketWithEmail('Refund please.')
    const { client } = stubAnthropic(async () => {
      // Gone by the time the answer comes back.
      await prisma.ticket.delete({ where: { id: ticket.id } })
      return message(JSON.stringify(refund))
    })

    await expect(processTicket(depsFor(client).deps, job)).resolves.toBeUndefined()
  })
})

describe('the pg-boss worker', () => {
  /** A job as pg-boss hands it with includeMetadata, on attempt `retryCount` of 2 retries. */
  const asJob = (data: ProcessTicketJob, retryCount = 0) =>
    ({ data, retryCount, retryLimit: 2 }) as JobWithMetadata<ProcessTicketJob>

  const rateLimited = () =>
    stubAnthropic(() => {
      throw new AiFailure('rate_limited', true, 'Rate limited by Anthropic')
    })

  test('processes each job in the batch it is handed', async () => {
    const first = await ticketWithEmail('Refund please.')
    const second = await ticketWithEmail('Refund me too.')
    const { client, requests } = answering(refund)

    await processTicketWorker(depsFor(client).deps)([asJob(first.job), asJob(second.job)])

    expect(requests).toHaveLength(2)
    expect(await prisma.replyDraft.count({ where: { status: 'pending' } })).toBe(2)
  })

  test('a failing AI call with retries left is thrown for pg-boss to retry', async () => {
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const worker = processTicketWorker(depsFor(rateLimited().client).deps)

    await expect(worker([asJob(job, 1)])).rejects.toBeInstanceOf(AiFailure)

    expect(await stored(ticket.id)).toMatchObject({ needsAgent: false, escalationReason: null })
  })

  test('a failing AI call on the last attempt escalates the ticket, still Open', async () => {
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const { deps, emails } = depsFor(rateLimited().client)

    // Resolves: the job is done with, and pg-boss must not try a fourth time.
    await expect(processTicketWorker(deps)([asJob(job, 2)])).resolves.toBeUndefined()

    expect(emails).toHaveLength(0)
    expect(await stored(ticket.id)).toMatchObject({
      status: 'open',
      needsAgent: true,
      escalationReason: 'ai_failed',
    })
  })

  test('a failure a retry cannot fix escalates on the first attempt', async () => {
    // A refusal: the same ticket is refused again, and each try is billed.
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const { client, requests } = stubAnthropic(() => message(null, 'refusal'))

    await expect(processTicketWorker(depsFor(client).deps)([asJob(job)])).resolves.toBeUndefined()

    expect(requests).toHaveLength(1)
    expect(await stored(ticket.id)).toMatchObject({
      status: 'open',
      needsAgent: true,
      escalationReason: 'ai_failed',
    })
  })

  test('a failed send is retried, then escalated like a failed AI call', async () => {
    const { ticket, job } = await ticketWithEmail('Week 2 videos spin forever.')
    const worker = processTicketWorker(
      depsFor(answering(technical).client, { failSend: true }).deps,
    )

    await expect(worker([asJob(job)])).rejects.toBeInstanceOf(EmailSendError)
    await worker([asJob(job, 2)])

    expect(await stored(ticket.id)).toMatchObject({
      status: 'open',
      needsAgent: true,
      escalationReason: 'ai_failed',
    })
  })

  test('a ticket already waiting on a refund approval keeps that reason', async () => {
    const { ticket, job } = await ticketWithEmail('Refund please.', {
      needsAgent: true,
      escalationReason: 'refund_approval',
    })

    await processTicketWorker(depsFor(rateLimited().client).deps)([asJob(job, 2)])

    expect(await stored(ticket.id)).toMatchObject({
      needsAgent: true,
      escalationReason: 'refund_approval',
    })
  })
})
