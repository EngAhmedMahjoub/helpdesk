import { isPrismaError, prisma } from '../db.ts'
import { parseInboundEmail, type ReceivedEmail } from './inbound.ts'
import { inboundTicketFields } from './inbound-fields.ts'

/**
 * What became of a received email. Every outcome is final: none is worth
 * Resend delivering the email again.
 */
export type IngestOutcome = 'created' | 'duplicate' | 'refused'

/**
 * Saves a received email as a new ticket holding it as the first message.
 *
 * Every email starts a ticket for now; matching a reply to the ticket it
 * answers comes before this in task 4.8.
 */
export async function ingestInboundEmail(received: ReceivedEmail): Promise<IngestOutcome> {
  const fields = inboundTicketFields(parseInboundEmail(received))
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

  try {
    // One statement, so the ticket and its message land together or not at all:
    // a duplicate caught by the unique index below leaves no empty ticket.
    await prisma.ticket.create({
      data: {
        ...ticket,
        messages: { create: { direction: 'inbound', author: 'student', body, emailMessageId } },
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
