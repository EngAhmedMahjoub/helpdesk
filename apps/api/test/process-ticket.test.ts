import { beforeEach, describe, expect, test } from 'bun:test'
import request from 'supertest'
import type { Job } from 'pg-boss'
import type { TicketDetail } from '@helpdesk/shared'
import { createApp } from '../src/app.ts'
import { AiFailure } from '../src/ai/failure.ts'
import {
  type ProcessTicketJob,
  processTicket,
  processTicketWorker,
} from '../src/jobs/process-ticket.ts'
import { message, stubAnthropic } from './ai-stub.ts'
import { prisma, resetDatabase } from './db.ts'
import { createMessage, createTicket, createUser, sessionCookieFor } from './fixtures.ts'

beforeEach(resetDatabase)

const answer = {
  category: 'refund' as const,
  summary: 'Wants a refund after the videos kept failing.',
  reply: 'Your refund request has been passed to the team.',
}

/** A stand-in client that answers every request with `answer`. */
const answering = () => stubAnthropic(() => message(JSON.stringify(answer)))

const deps = (client: ReturnType<typeof stubAnthropic>['client']) => ({
  prisma,
  client,
  knowledgeBase: '<article file="refunds.md" category="refund">Refunds.</article>',
})

describe('processing a ticket', () => {
  test('saves the category and summary the model gave', async () => {
    const ticket = await createTicket({ category: null, summary: null })
    const inbound = await createMessage({ ticketId: ticket.id, body: 'Just refund me.' })

    await processTicket(deps(answering().client), { ticketId: ticket.id, messageId: inbound.id })

    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      category: 'refund',
      summary: 'Wants a refund after the videos kept failing.',
    })
  })

  test('the saved values are what the ticket detail returns', async () => {
    // The API side of "values shown on ticket detail": the page renders these
    // two fields from this response.
    const ticket = await createTicket({ category: null, summary: null })
    const inbound = await createMessage({ ticketId: ticket.id, body: 'Just refund me.' })
    await processTicket(deps(answering().client), { ticketId: ticket.id, messageId: inbound.id })
    const agent = await createUser()

    const res = await request(createApp())
      .get(`/api/tickets/${String(ticket.id)}`)
      .set('Cookie', await sessionCookieFor(agent.id))

    expect(res.status).toBe(200)
    expect(res.body as TicketDetail).toMatchObject({
      category: 'refund',
      summary: 'Wants a refund after the videos kept failing.',
    })
  })

  test('replaces an earlier category and summary, as a follow-up does', async () => {
    const ticket = await createTicket({ category: 'technical', summary: 'Videos will not load.' })
    const inbound = await createMessage({ ticketId: ticket.id, body: 'Still broken. Refund me.' })

    await processTicket(deps(answering().client), { ticketId: ticket.id, messageId: inbound.id })

    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      category: 'refund',
      summary: 'Wants a refund after the videos kept failing.',
    })
  })

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
    const { client, requests } = answering()

    await processTicket(deps(client), { ticketId: ticket.id, messageId: first.id })

    const sent = (requests[0]!.messages as { content: string }[])[0]!.content
    expect(sent.indexOf('First message')).toBeLessThan(sent.indexOf('Second message'))
  })

  test('leaves the rest of the ticket alone, and adds no message', async () => {
    // Status, the escalation and the reply are 5.13's routing, not this task's.
    const ticket = await createTicket({
      status: 'open',
      needsAgent: true,
      escalationReason: 'ai_failed',
      subject: 'Kept as it was',
    })
    const inbound = await createMessage({ ticketId: ticket.id })

    await processTicket(deps(answering().client), { ticketId: ticket.id, messageId: inbound.id })

    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      status: 'open',
      needsAgent: true,
      escalationReason: 'ai_failed',
      subject: 'Kept as it was',
    })
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(1)
  })

  test('a failed call throws for pg-boss to retry, and changes nothing', async () => {
    const ticket = await createTicket({ category: 'general', summary: 'Before' })
    const inbound = await createMessage({ ticketId: ticket.id })
    const { client } = stubAnthropic(() => message(null, 'refusal'))

    await expect(
      processTicket(deps(client), { ticketId: ticket.id, messageId: inbound.id }),
    ).rejects.toBeInstanceOf(AiFailure)
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      category: 'general',
      summary: 'Before',
    })
  })

  test('a ticket deleted before the job ran is skipped without asking the model', async () => {
    const { client, requests } = answering()

    await processTicket(deps(client), { ticketId: 999_999, messageId: 1 })

    expect(requests).toHaveLength(0)
  })

  test('a ticket deleted while the model answered is skipped, not retried', async () => {
    const ticket = await createTicket()
    const inbound = await createMessage({ ticketId: ticket.id })
    const { client } = stubAnthropic(async () => {
      // Gone by the time the answer comes back.
      await prisma.ticket.delete({ where: { id: ticket.id } })
      return message(JSON.stringify(answer))
    })

    await expect(
      processTicket(deps(client), { ticketId: ticket.id, messageId: inbound.id }),
    ).resolves.toBeUndefined()
  })
})

describe('the pg-boss worker', () => {
  test('processes each job in the batch it is handed', async () => {
    const first = await createTicket({ category: null, summary: null })
    const second = await createTicket({ category: null, summary: null })
    const a = await createMessage({ ticketId: first.id })
    const b = await createMessage({ ticketId: second.id })
    const { client, requests } = answering()
    const job = (data: ProcessTicketJob) => ({ data }) as Job<ProcessTicketJob>

    await processTicketWorker(deps(client))([
      job({ ticketId: first.id, messageId: a.id }),
      job({ ticketId: second.id, messageId: b.id }),
    ])

    expect(requests).toHaveLength(2)
    for (const id of [first.id, second.id]) {
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id } })).category).toBe('refund')
    }
  })
})
