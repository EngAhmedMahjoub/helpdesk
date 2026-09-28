import type Anthropic from '@anthropic-ai/sdk'
import { MESSAGE_PAGE_SIZE } from '@helpdesk/shared'
import { type PgBoss, type PrismaTransactionLike, type WorkHandler, fromPrisma } from 'pg-boss'
import { analyseTicket } from '../ai/prompt.ts'
import { isPrismaError } from '../db.ts'
import type { PrismaClient } from '../generated/prisma/client.ts'

/** The queue a saved inbound message waits on for the AI (task 5.2). */
export const PROCESS_TICKET = 'process-ticket'

/** Which message to act on, and the ticket it belongs to. Ids only: the job reads the rest fresh. */
export type ProcessTicketJob = { ticketId: number; messageId: number }

/**
 * Queues a process-ticket job inside the transaction `tx` that saves the
 * message, so the two commit or roll back together.
 */
export type QueueProcessTicket = (job: ProcessTicketJob, tx: PrismaTransactionLike) => Promise<void>

export function processTicketQueue(boss: PgBoss): QueueProcessTicket {
  return async (job, tx) => {
    // Sent through the caller's transaction, not pg-boss's own pool. Queued
    // separately, a failure between saving and queuing would leave a message
    // no job ever picks up: the webhook's 500 would have Resend redeliver, and
    // the redelivery would be dropped as a duplicate of the saved message.
    await boss.send(PROCESS_TICKET, job, { db: fromPrisma(tx) })
  }
}

/** The queues the API sends to, created on start; creating one that exists is a no-op. */
export async function createQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(PROCESS_TICKET)
}

/** What the worker needs, passed in so tests can stand a client in for Anthropic. */
export type ProcessTicketDeps = {
  prisma: PrismaClient
  client: Anthropic
  knowledgeBase: string
}

/**
 * Asks the model about a ticket's thread and saves the category and summary it
 * gives. The reply it also drafts is not used yet: sending it, or saving it as a
 * draft for a refund, is 5.13's routing.
 *
 * An `AiFailure` is thrown on, for pg-boss to retry; which failures deserve a
 * retry and what happens after the last is 5.15's.
 */
export async function processTicket(deps: ProcessTicketDeps, job: ProcessTicketJob): Promise<void> {
  const ticket = await deps.prisma.ticket.findUnique({
    where: { id: job.ticketId },
    select: {
      subject: true,
      studentName: true,
      studentEmail: true,
      messages: {
        select: { author: true, body: true, createdAt: true },
        // The newest, capped as the detail page caps them: the model reads
        // what an agent would, and a thread cannot grow the bill without end.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MESSAGE_PAGE_SIZE,
      },
    },
  })

  // Deleted since the job was queued: there is nothing left to classify, and
  // throwing would only have pg-boss retry a ticket that will never come back.
  if (!ticket) return

  const { output } = await analyseTicket(deps.client, deps.knowledgeBase, {
    ...ticket,
    // Selected newest first for the cap; a thread reads the other way.
    messages: ticket.messages.reverse(),
  })

  try {
    await deps.prisma.ticket.update({
      where: { id: job.ticketId },
      data: { category: output.category, summary: output.summary },
    })
  } catch (error) {
    // Deleted while the model was answering. Same as above: nothing to save.
    if (isPrismaError(error, 'P2025')) return
    throw error
  }
}

/** The pg-boss handler: jobs arrive in batches, one at a time by default. */
export function processTicketWorker(deps: ProcessTicketDeps): WorkHandler<ProcessTicketJob> {
  return async (jobs) => {
    for (const job of jobs) await processTicket(deps, job.data)
  }
}
