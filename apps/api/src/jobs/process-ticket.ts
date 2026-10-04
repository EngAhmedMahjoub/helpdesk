import type Anthropic from '@anthropic-ai/sdk'
import {
  type AiOutput,
  type EscalationReason,
  MESSAGE_PAGE_SIZE,
  type TicketCategory,
} from '@helpdesk/shared'
import {
  type PgBoss,
  type PrismaTransactionLike,
  type QueueOptions,
  type WorkWithMetadataHandler,
  fromPrisma,
} from 'pg-boss'
import { AiFailure } from '../ai/failure.ts'
import { atSendLimit, overCallBudget, withinBudget } from '../ai/limits.ts'
import { analyseTicket } from '../ai/prompt.ts'
import { decideRouting, studentText } from '../ai/refund-safeguard.ts'
import { usageLine } from '../ai/usage.ts'
import { isPrismaError } from '../db.ts'
import type { SendEmail } from '../email/outbound.ts'
import { outboundMessage, replyEmail } from '../email/reply-thread.ts'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { resolveIfOpen } from '../tickets/status.ts'

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

/**
 * Two retries, about a minute and then two minutes after the failure (5.15).
 * The SDK has already retried a 429 or 5xx twice within seconds, so a failure
 * that reaches the job is an outage worth waiting out rather than hammering;
 * a ticket answered a few minutes late beats one handed to an agent.
 */
export const PROCESS_TICKET_RETRIES = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
} satisfies QueueOptions

/**
 * The queues the API sends to, created on start. Updated as well as created:
 * creating one that exists is a no-op, so a queue made before its retry
 * policy was set would otherwise keep the defaults. Each job copies the
 * policy when it is queued.
 */
export async function createQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(PROCESS_TICKET, PROCESS_TICKET_RETRIES)
  await boss.updateQueue(PROCESS_TICKET, PROCESS_TICKET_RETRIES)
}

/** What the worker needs, passed in so tests can stand in for Anthropic and Resend. */
export type ProcessTicketDeps = {
  prisma: PrismaClient
  client: Anthropic
  knowledgeBase: string
  sendEmail: SendEmail
}

/** What decides whether the AI's answer is emailed or held for an agent. */
export type HoldFacts = {
  /** The model or the refund safeguard routed the ticket to an agent. */
  routedToAgent: boolean
  /** The ticket is already waiting on a refund approval, or has a draft pending. */
  refundWaiting: boolean
  senderVerified: boolean
  escalationReason: EscalationReason | null
  assigned: boolean
  /** The AI has emailed this ticket, or everyone, as often as it may for now. */
  sendLimited: boolean
}

/**
 * Why the AI's answer waits for an agent instead of being emailed, or null to
 * send it (#263). When several apply, the first wins, in the order
 * tech-stack.md "AI limits and holds" documents.
 */
export function holdReason(facts: HoldFacts): EscalationReason | null {
  // A refund already waiting for approval keeps the ticket with agents, even
  // when this message says nothing about money: the model may have caught a
  // refund the keyword list could not, and answering the follow-up would
  // resolve the ticket, and in time auto-close it, with the draft unseen.
  if (facts.routedToAgent || facts.refundWaiting) return 'refund_approval'
  if (!facts.senderVerified) return 'unverified_sender'
  // One that failed the AI before is with an agent already (6.9).
  if (facts.escalationReason === 'ai_failed') return 'ai_failed'
  // An agent already on the ticket answers it, not the AI over their head (6.9).
  if (facts.assigned) return 'agent_assigned'
  if (facts.sendLimited) return 'auto_reply_limit'
  return null
}

/**
 * Asks the model about a ticket's thread and acts on the answer (5.13). A
 * refund, by the model's word or the safeguard's, is saved as a draft for an
 * agent to approve; anything else is emailed to the student and the ticket
 * resolved.
 *
 * A follow-up on a Resolved or Closed ticket takes the same two paths and
 * updates the category and summary, but keeps its status (5.14): the student
 * writing back has not reopened it, as the inbound webhook already holds (4.9).
 *
 * Before anything is emailed, four checks can hold the reply for an agent
 * instead (#239): a refund draft already waiting, a sender who did not pass
 * DMARC, the AI's send limits, and, before the model is even asked, its call
 * budget.
 *
 * An `AiFailure` or an `EmailSendError` is thrown on; the worker below
 * decides between a retry and handing the ticket to an agent.
 */
export async function processTicket(deps: ProcessTicketDeps, job: ProcessTicketJob): Promise<void> {
  const ticket = await deps.prisma.ticket.findUnique({
    where: { id: job.ticketId },
    select: {
      subject: true,
      studentName: true,
      studentEmail: true,
      senderVerified: true,
      escalationReason: true,
      assigneeId: true,
      replyDrafts: { where: { status: 'pending' }, select: { id: true }, take: 1 },
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

  // A newer student message has its own job, which answers the whole thread,
  // this message included (6.10). Answering here as well would email the
  // student twice: jobs run one at a time, so the two would not overlap, they
  // would follow each other. Only one message is the newest, so this holds
  // with any number of workers too. Ids rise with every insert.
  const newer = await deps.prisma.message.count({
    where: { ticketId: job.ticketId, direction: 'inbound', id: { gt: job.messageId } },
  })
  if (newer > 0) {
    console.log(`AI skipped: ticket=${String(job.ticketId)} reason=newer_message`)
    return
  }

  // Checked before the call, since the call is what costs: past the budget
  // the model is not asked, and an agent answers instead.
  if (await overCallBudget(deps.prisma, job.ticketId)) {
    console.log(`AI skipped: ticket=${String(job.ticketId)} reason=call_budget`)
    await escalate(deps.prisma, job.ticketId)
    return
  }

  // Read before the call too, so nothing between a paid call and its usage
  // line can fail: whether the AI may email is known before it answers.
  const sendLimited = await atSendLimit(deps.prisma, job.ticketId)

  // Selected newest first for the caps; a thread reads the other way.
  const messages = withinBudget(ticket.messages).reverse()
  let analysis
  try {
    analysis = await analyseTicket(deps.client, deps.knowledgeBase, { ...ticket, messages })
  } catch (error) {
    // A refused or cut-off answer is billed like any other, so it is counted
    // too. Failures without usage never reached the model, and cost nothing.
    if (error instanceof AiFailure && error.usage) {
      console.log(usageLine(job.ticketId, error.usage, `failed_${error.reason}`))
    }
    throw error
  }
  const { output, usage } = analysis

  // The model's category stands unless the student or the draft talks about
  // money back, in which case a person approves the reply before it goes out.
  // The trimmed thread, not ticket.messages: the safeguard reads what the
  // model was shown.
  const decision = decideRouting(output, studentText({ subject: ticket.subject, messages }))

  const heldFor = holdReason({
    routedToAgent: decision.route === 'agent',
    refundWaiting: ticket.escalationReason === 'refund_approval' || ticket.replyDrafts.length > 0,
    senderVerified: ticket.senderVerified,
    escalationReason: ticket.escalationReason,
    assigned: ticket.assigneeId !== null,
    sendLimited,
  })

  // Logged once the call is paid for, before anything is saved: a save that
  // fails afterwards does not make the call free. The safeguard's override is
  // named, so how often it overrules the model can be counted (5.18).
  const outcome =
    heldFor === null ? 'reply' : heldFor === 'refund_approval' ? 'refund_draft' : `held_${heldFor}`
  const forced = decision.forcedBy.length > 0 ? ` forced_by=${decision.forcedBy.length}` : ''
  console.log(`${usageLine(job.ticketId, usage, outcome)}${forced}`)

  try {
    if (heldFor) {
      const category = heldFor === 'refund_approval' ? 'refund' : decision.category
      await saveDraft(deps.prisma, job.ticketId, output, category, heldFor)
    } else {
      await sendReply(deps, job.ticketId, ticket, output, decision.category)
    }
  } catch (error) {
    // Deleted while the model was answering. Same as above: nothing to save.
    if (isPrismaError(error, 'P2025')) return
    throw error
  }
}

/**
 * The reply waits as a draft and the ticket is flagged for an agent, with the
 * reason it was held. Nothing is emailed until someone approves it (6.2).
 *
 * One pending draft per ticket: a follow-up while one waits replaces its body
 * rather than queuing a second, since the newer draft answers the whole thread
 * and the older one would only be a stale thing to reject. One transaction, so
 * a ticket is never flagged without its draft, or the reverse.
 */
export async function saveDraft(
  prisma: PrismaClient,
  ticketId: number,
  output: AiOutput,
  category: TicketCategory,
  reason: EscalationReason,
): Promise<void> {
  try {
    await saveDraftOnce(prisma, ticketId, output, category, reason)
  } catch (error) {
    // Another job created the pending draft between this one's update and
    // its insert, and the one-pending index refused the second (6.11). The
    // draft exists now, so a second try updates it.
    if (!isPrismaError(error, 'P2002')) throw error
    await saveDraftOnce(prisma, ticketId, output, category, reason)
  }
}

async function saveDraftOnce(
  prisma: PrismaClient,
  ticketId: number,
  output: AiOutput,
  category: TicketCategory,
  reason: EscalationReason,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        category,
        summary: output.summary,
        needsAgent: true,
        escalationReason: reason,
      },
    })

    // The status is the update's own condition, so a draft an agent reviewed
    // a moment ago is never rewritten; there is then none pending, and a new
    // one is created.
    const { count } = await tx.replyDraft.updateMany({
      where: { ticketId, status: 'pending' },
      data: { body: output.reply },
    })
    if (count === 0) await tx.replyDraft.create({ data: { ticketId, body: output.reply } })
  })
}

/**
 * The general and technical path: the reply is emailed, then saved as an AI
 * message, and an Open ticket is resolved. A Resolved or Closed one keeps its
 * status and its auto-close timer, which the inbound webhook already restarted.
 *
 * Emailed before it is saved, as an agent's reply is (4.3): the other order
 * can leave a reply in the thread the student never received. A failed send
 * saves nothing and throws for pg-boss to try again. The cost of this order is
 * a narrow window — the email sent, then the save failing — in which a retry
 * would email the student a second time.
 */
async function sendReply(
  deps: ProcessTicketDeps,
  ticketId: number,
  ticket: { subject: string; studentEmail: string },
  output: AiOutput,
  category: TicketCategory,
): Promise<void> {
  await deps.sendEmail({
    ...(await replyEmail({ id: ticketId, ...ticket }, output.reply, deps.prisma)),
    // Machine-sent, so marked for auto-responders not to answer (#239).
    automatic: true,
  })

  await deps.prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: { category, summary: output.summary },
    })
    await resolveIfOpen(tx, ticketId)
    await tx.message.create({
      data: outboundMessage({ ticketId, author: 'ai', body: output.reply }),
    })
  })
}

/**
 * The pg-boss handler: jobs arrive in batches, one at a time by default.
 * Registered with `includeMetadata`, for the retry count.
 *
 * A failure is thrown for pg-boss to retry, unless it is the last attempt or
 * an `AiFailure` a retry cannot fix, such as a refusal. Then the ticket goes
 * to an agent (5.15) and the job completes: the student's email is still
 * unanswered, and nothing else would tell anyone. Any other error — a failed
 * send, a bug — is retried too, and escalated the same way when it outlasts
 * the retries.
 */
export function processTicketWorker(
  deps: ProcessTicketDeps,
): WorkWithMetadataHandler<ProcessTicketJob> {
  return async (jobs) => {
    for (const job of jobs) {
      try {
        await processTicket(deps, job.data)
      } catch (error) {
        const retryable = !(error instanceof AiFailure) || error.retryable
        if (retryable && job.retryCount < job.retryLimit) throw error
        console.error(`Ticket ${String(job.data.ticketId)} sent to an agent: ${describe(error)}`)
        await escalate(deps.prisma, job.data.ticketId)
      }
    }
  }
}

/**
 * What failed, without its message (#239): a Prisma validation error's
 * message quotes the call's arguments, which here include the reply and the
 * summary. The name, and the reason or code where the error has one, say
 * which failure it was.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  if (error instanceof AiFailure) return `${error.name} reason=${error.reason}`
  const code = 'code' in error && typeof error.code === 'string' ? ` code=${error.code}` : ''
  return `${error.name}${code}`
}

/**
 * Flags the ticket for an agent with reason `ai_failed`. The status is left
 * as it is: nobody has answered the student, so an Open ticket stays Open.
 *
 * A ticket already flagged keeps its reason: a refund draft waiting for
 * approval is the more specific thing for an agent to see, and it still
 * waits. A deleted ticket matches nothing, which is all there is to do.
 */
async function escalate(prisma: PrismaClient, ticketId: number): Promise<void> {
  await prisma.ticket.updateMany({
    where: { id: ticketId, needsAgent: false },
    data: { needsAgent: true, escalationReason: 'ai_failed' },
  })
}
