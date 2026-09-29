import type Anthropic from '@anthropic-ai/sdk'
import { type AiOutput, MESSAGE_PAGE_SIZE, type TicketCategory } from '@helpdesk/shared'
import { type PgBoss, type PrismaTransactionLike, type WorkHandler, fromPrisma } from 'pg-boss'
import { analyseTicket } from '../ai/prompt.ts'
import { decideRouting } from '../ai/refund-safeguard.ts'
import { isPrismaError } from '../db.ts'
import type { SendEmail } from '../email/outbound.ts'
import { replySubject, replyThread } from '../email/reply-thread.ts'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { statusChange } from '../tickets/status.ts'

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

/** What the worker needs, passed in so tests can stand in for Anthropic and Resend. */
export type ProcessTicketDeps = {
  prisma: PrismaClient
  client: Anthropic
  knowledgeBase: string
  sendEmail: SendEmail
}

/**
 * Asks the model about a ticket's thread and acts on the answer (5.13). A
 * refund, by the model's word or the safeguard's, is saved as a draft for an
 * agent to approve; anything else is emailed to the student and the ticket
 * resolved.
 *
 * An `AiFailure` or an `EmailSendError` is thrown on, for pg-boss to retry;
 * which failures deserve a retry and what happens after the last is 5.15's.
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

  // Deleted since the job was queued: there is nothing left to answer, and
  // throwing would only have pg-boss retry a ticket that will never come back.
  if (!ticket) return

  // Selected newest first for the cap; a thread reads the other way.
  const messages = ticket.messages.reverse()
  const { output } = await analyseTicket(deps.client, deps.knowledgeBase, { ...ticket, messages })

  // The model's category stands unless the student or the draft talks about
  // money back, in which case a person approves the reply before it goes out.
  const decision = decideRouting(output, {
    subject: ticket.subject,
    studentMessages: messages
      .filter((message) => message.author === 'student')
      .map((message) => message.body),
  })

  try {
    if (decision.route === 'agent') {
      await saveForApproval(deps.prisma, job.ticketId, output, decision.category)
    } else {
      await sendAndResolve(deps, job.ticketId, ticket, output, decision.category)
    }
  } catch (error) {
    // Deleted while the model was answering. Same as above: nothing to save.
    if (isPrismaError(error, 'P2025')) return
    throw error
  }
}

/**
 * The refund path: the reply waits as a draft and the ticket is flagged for an
 * agent. Nothing is emailed until someone approves it (6.2).
 *
 * One pending draft per ticket: a follow-up while one waits replaces its body
 * rather than queuing a second, since the newer draft answers the whole thread
 * and the older one would only be a stale thing to reject. One transaction, so
 * a ticket is never flagged without its draft, or the reverse.
 */
async function saveForApproval(
  prisma: PrismaClient,
  ticketId: number,
  output: AiOutput,
  category: TicketCategory,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        category,
        summary: output.summary,
        needsAgent: true,
        escalationReason: 'refund_approval',
      },
    })

    const pending = await tx.replyDraft.findFirst({
      where: { ticketId, status: 'pending' },
      select: { id: true },
    })
    if (pending) {
      await tx.replyDraft.update({ where: { id: pending.id }, data: { body: output.reply } })
    } else {
      await tx.replyDraft.create({ data: { ticketId, body: output.reply } })
    }
  })
}

/**
 * The general and technical path: the reply is emailed, then saved as an AI
 * message on a ticket now Resolved.
 *
 * Emailed before it is saved, as an agent's reply is (4.3): the other order
 * can leave a reply in the thread the student never received. A failed send
 * saves nothing and throws for pg-boss to try again. The cost of this order is
 * a narrow window — the email sent, then the save failing — in which a retry
 * would email the student a second time.
 */
async function sendAndResolve(
  deps: ProcessTicketDeps,
  ticketId: number,
  ticket: { subject: string; studentEmail: string },
  output: AiOutput,
  category: TicketCategory,
): Promise<void> {
  await deps.sendEmail({
    to: ticket.studentEmail,
    subject: replySubject(ticket.subject),
    text: output.reply,
    thread: await replyThread(ticketId, deps.prisma),
  })

  await deps.prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      // Resolved through statusChange, so the 14-day auto-close timer starts.
      data: { category, summary: output.summary, ...statusChange('resolved') },
    })
    await tx.message.create({
      data: {
        ticketId,
        direction: 'outbound',
        author: 'ai',
        body: output.reply,
        // Null, as on an agent's reply: Amazon SES sets the Message-ID and
        // does not report it back.
        emailMessageId: null,
      },
    })
  })
}

/** The pg-boss handler: jobs arrive in batches, one at a time by default. */
export function processTicketWorker(deps: ProcessTicketDeps): WorkHandler<ProcessTicketJob> {
  return async (jobs) => {
    for (const job of jobs) await processTicket(deps, job.data)
  }
}
