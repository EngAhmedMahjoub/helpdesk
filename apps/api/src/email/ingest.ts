import { isPrismaError, prisma } from '../db.ts'
import type { QueueProcessTicket } from '../jobs/process-ticket.ts'
import { statusChange } from '../tickets/status.ts'
import { isAutomatedEmail, parseInboundEmail, passedDmarc, type ReceivedEmail } from './inbound.ts'
import { inboundTicketFields } from './inbound-fields.ts'
import { isStorableMessageId } from './message-id.ts'

/**
 * What became of a received email. Every outcome is final: none is worth
 * Resend delivering the email again.
 */
export type IngestOutcome =
  'created' | 'appended' | 'duplicate' | 'refused' | 'automated' | 'capped'

// Task 5.2b. Each new ticket costs a Resend fetch now and an Anthropic call
// once the AI answers it, and nothing else limits inbound volume. A student
// rarely opens more than one or two an hour; four still leaves room for a few
// separate questions while a flood from one address stops there.
const NEW_TICKETS_PER_SENDER = 4
const NEW_TICKET_WINDOW_MS = 60 * 60 * 1000

/**
 * Whether `sender` has already opened as many tickets as the cap allows in the
 * last hour. Counted from the tickets themselves, ignoring the address's case
 * as reply matching does, so there is no second store to keep in step. The
 * count and the insert are not one step, so emails arriving together can pass
 * it by one or two; for a flood guard that is close enough.
 *
 * Keyed on the sender, not an IP limit on the webhook: every legitimate webhook
 * call comes from Resend's own servers.
 */
async function overNewTicketCap(sender: string, now: Date): Promise<boolean> {
  const opened = await prisma.ticket.count({
    where: {
      studentEmail: { equals: sender, mode: 'insensitive' },
      createdAt: { gt: new Date(now.getTime() - NEW_TICKET_WINDOW_MS) },
    },
  })
  return opened >= NEW_TICKETS_PER_SENDER
}

// Enough for any real thread. The IDs come from the sender, and without a cap a
// crafted References header could make one lookup ask for thousands.
const THREAD_IDS_MAX = 100

/**
 * The Message-IDs a reply points at, nearest first: In-Reply-To, then
 * References newest to oldest. References is what matches in practice: our
 * replies go out with a Message-ID Amazon SES sets and never reports, so a
 * student's In-Reply-To names one we do not have, while References still
 * carries the student's own earlier IDs.
 *
 * Over the cap, the middle of the chain goes. The first reference always stays:
 * it is the student's opening email, the one surest to be stored, and the one
 * RFC 5322 has mail clients keep when they trim a long chain themselves.
 */
function threadIds(inReplyTo: string | null, references: string[]): string[] {
  const recent = references.slice(-(THREAD_IDS_MAX - 2)).toReversed()
  const ids = [inReplyTo, ...recent, references[0]].filter(
    // Only IDs that could have been stored can match one.
    (id): id is string => !!id && isStorableMessageId(id),
  )
  return [...new Set(ids)]
}

/**
 * The ticket a reply belongs to (task 4.8), or null to start a new one.
 *
 * Only the ticket's own student can add to it. Message-IDs are not secret:
 * anyone copied on the thread has seen them, and matching on them alone would
 * let that person write into another student's ticket. A student writing from
 * a second address gets a new ticket instead.
 */
async function ticketForReply(ids: string[], sender: string): Promise<number | null> {
  if (ids.length === 0) return null

  const matches = await prisma.message.findMany({
    where: {
      emailMessageId: { in: ids },
      ticket: { studentEmail: { equals: sender, mode: 'insensitive' } },
    },
    select: { emailMessageId: true, ticketId: true },
  })

  // Nearest first: when the IDs reach more than one ticket, the one the email
  // answers directly wins over one further back in the chain.
  for (const id of ids) {
    const match = matches.find((message) => message.emailMessageId === id)
    if (match) return match.ticketId
  }
  return null
}

/**
 * Saves a received email: appended to the ticket it replies to, or as a new
 * ticket holding it as the first message. Either way a process-ticket job is
 * queued for it in the same transaction (task 5.2), so a saved message always
 * has a job and a rolled-back one never does.
 */
export async function ingestInboundEmail(
  received: ReceivedEmail,
  queueProcessTicket: QueueProcessTicket,
): Promise<IngestOutcome> {
  if (isAutomatedEmail(received)) return 'automated'

  const email = parseInboundEmail(received)
  const fields = inboundTicketFields(email)
  if (!fields) return 'refused'

  const { emailMessageId, body, ...ticket } = fields

  // Task 4.6. Resend redelivers an event until it is acknowledged, and one
  // email can reach the inbox twice; either way its Message-ID is already here.
  if (emailMessageId) {
    const seen = await prisma.message.findUnique({
      where: { emailMessageId },
      select: { id: true },
    })
    if (seen) return 'duplicate'
  }

  const message = { direction: 'inbound', author: 'student', body, emailMessageId } as const
  // Only a reply that passed DMARC may join a ticket (task 5.2a): the address
  // check in ticketForReply is only as good as the From it compares. Any other
  // reply still opens a ticket of its own, so no student's mail is dropped.
  const verified = passedDmarc(received)
  const ticketId = verified
    ? await ticketForReply(threadIds(email.inReplyTo, email.references), ticket.studentEmail)
    : null

  try {
    if (ticketId !== null) {
      const now = new Date()
      // The reply adds to the thread; the subject stays the ticket's own and the
      // status is never changed (task 4.9). A student writing back to a Resolved
      // or Closed ticket has not reopened it: what happens next is decided
      // later, by the AI or an agent.
      await prisma.$transaction(async (tx) => {
        const saved = await tx.message.create({
          data: { ...message, ticketId },
          select: { id: true },
        })
        // Activity, like an agent's reply: the ticket rises in a list by updatedAt.
        await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: now } })
        // A Resolved ticket the student is still writing on should not close
        // under them, so its timer starts over. The status is the statement's
        // own condition rather than read beforehand, so an agent changing it at
        // the same moment cannot leave a timer on a ticket that is no longer
        // Resolved. Closed and Open tickets have no timer to reset.
        // Through statusChange, as every status write is: setting Resolved on a
        // ticket the condition already holds Resolved changes only the timer.
        await tx.ticket.updateMany({
          where: { id: ticketId, status: 'resolved' },
          data: statusChange('resolved', now),
        })
        await queueProcessTicket({ ticketId, messageId: saved.id }, tx)
      })
      return 'appended'
    }

    // Only a new ticket is capped: a reply joining one the student already has
    // costs no new ticket and is never held back.
    if (await overNewTicketCap(ticket.studentEmail, new Date())) return 'capped'

    // One transaction, so the ticket, its message and the job land together or
    // not at all: a duplicate caught by the unique index below leaves no empty
    // ticket and no job.
    await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        // Recorded for the AI (#239): it emails only a sender who passed
        // DMARC, since anyone can forge the From of a new ticket.
        data: { ...ticket, senderVerified: verified, messages: { create: message } },
        select: { id: true, messages: { select: { id: true } } },
      })
      const [first] = created.messages
      if (!first) throw new Error('A new ticket was saved without its message')
      await queueProcessTicket({ ticketId: created.id, messageId: first.id }, tx)
    })
  } catch (err) {
    // Two deliveries of the same email racing past the check above: the
    // unique index on emailMessageId lets only one through.
    if (isPrismaError(err, 'P2002')) return 'duplicate'
    throw err
  }
  return 'created'
}
