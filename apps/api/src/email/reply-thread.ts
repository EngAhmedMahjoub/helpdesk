import { prisma as defaultPrisma } from '../db.ts'
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'
import type { OutboundEmail } from './outbound.ts'

// How many of the student's latest emails a reply's References names, besides
// their first. The IDs become one header, so a ticket that runs to hundreds of
// messages must not make it hundreds of KB, which Resend could refuse on every
// reply (#210). Mail clients thread on the first ID and the latest few.
const REPLY_THREAD_RECENT = 20

/**
 * The Message-IDs a reply threads onto, an agent's or the AI's, oldest first:
 * the student's first email and their latest REPLY_THREAD_RECENT. Our own
 * outbound messages have no Message-ID to add: Amazon SES sets one and does
 * not report it.
 */
export async function replyThread(
  ticketId: number,
  prisma: PrismaClient = defaultPrisma,
): Promise<string[]> {
  const where = {
    ticketId,
    direction: 'inbound',
    emailMessageId: { not: null },
  } satisfies Prisma.MessageWhereInput
  const select = { id: true, emailMessageId: true } as const
  const orderBy = [
    { createdAt: 'asc' },
    { id: 'asc' },
  ] satisfies Prisma.MessageOrderByWithRelationInput[]

  const [first, recent] = await Promise.all([
    prisma.message.findFirst({ where, select, orderBy }),
    // A negative take counts from the end: the latest, still oldest first.
    prisma.message.findMany({ where, select, orderBy, take: -REPLY_THREAD_RECENT }),
  ])
  const messages = first && !recent.some((m) => m.id === first.id) ? [first, ...recent] : recent
  return messages.flatMap((m) => (m.emailMessageId ? [m.emailMessageId] : []))
}

/** The ticket's subject as a reply's, without stacking a second "Re:". */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`
}

/**
 * The email a reply on this ticket goes out as, whoever wrote it: to the
 * student, under the ticket's subject, threaded onto their emails. One builder
 * for an agent's reply, an approved draft and the AI's reply (#267); the AI's
 * caller adds `automatic`, which a person's reply must not carry.
 */
export async function replyEmail(
  ticket: { id: number; subject: string; studentEmail: string },
  text: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<OutboundEmail> {
  return {
    to: ticket.studentEmail,
    subject: replySubject(ticket.subject),
    text,
    thread: await replyThread(ticket.id, prisma),
  }
}

/**
 * The row a sent reply is saved as: an outbound message by the agent who wrote
 * or approved it, or by the AI. Builds the `data` only; when it is saved, and
 * in which transaction, stays with each caller.
 */
export function outboundMessage({
  ticketId,
  author,
  agentId = null,
  body,
}: {
  ticketId: number
  author: 'agent' | 'ai'
  agentId?: string | null
  body: string
}) {
  return {
    ticketId,
    direction: 'outbound',
    author,
    agentId,
    body,
    // Stays null: Resend sends through Amazon SES, which sets its own
    // Message-ID and does not report it back. A student's reply is matched to
    // the ticket by the References it carries, not by this.
    emailMessageId: null,
  } satisfies Prisma.MessageUncheckedCreateInput
}
