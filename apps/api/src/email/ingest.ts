import { isPrismaError, prisma } from '../db.ts'
import { AUTO_CLOSE_AFTER_MS } from '../tickets/status.ts'
import { isAutomatedEmail, parseInboundEmail, type ReceivedEmail } from './inbound.ts'
import { MESSAGE_ID_MAX_LENGTH, inboundTicketFields } from './inbound-fields.ts'

/**
 * What became of a received email. Every outcome is final: none is worth
 * Resend delivering the email again.
 */
export type IngestOutcome = 'created' | 'appended' | 'duplicate' | 'refused' | 'automated'

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
    (id): id is string => !!id && id.length <= MESSAGE_ID_MAX_LENGTH,
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
 * ticket holding it as the first message.
 */
export async function ingestInboundEmail(received: ReceivedEmail): Promise<IngestOutcome> {
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
  const ticketId = await ticketForReply(
    threadIds(email.inReplyTo, email.references),
    ticket.studentEmail,
  )

  try {
    if (ticketId !== null) {
      const now = new Date()
      // The reply adds to the thread; the subject stays the ticket's own and the
      // status is never changed (task 4.9). A student writing back to a Resolved
      // or Closed ticket has not reopened it: what happens next is decided
      // later, by the AI or an agent.
      await prisma.$transaction([
        prisma.message.create({ data: { ...message, ticketId } }),
        // Activity, like an agent's reply: the ticket rises in a list by updatedAt.
        prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: now } }),
        // A Resolved ticket the student is still writing on should not close
        // under them, so its timer starts over. The status is the statement's
        // own condition rather than read beforehand, so an agent changing it at
        // the same moment cannot leave a timer on a ticket that is no longer
        // Resolved. Closed and Open tickets have no timer to reset.
        prisma.ticket.updateMany({
          where: { id: ticketId, status: 'resolved' },
          data: { autoCloseAt: new Date(now.getTime() + AUTO_CLOSE_AFTER_MS) },
        }),
      ])
      return 'appended'
    }

    // One statement, so the ticket and its message land together or not at all:
    // a duplicate caught by the unique index below leaves no empty ticket.
    await prisma.ticket.create({
      data: {
        ...ticket,
        messages: { create: message },
      },
    })
  } catch (err) {
    // Two deliveries of the same email racing past the check above: the
    // unique index on emailMessageId lets only one through.
    if (isPrismaError(err, 'P2002')) return 'duplicate'
    throw err
  }
  return 'created'
}
