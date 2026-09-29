import { prisma as defaultPrisma } from '../db.ts'
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'

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
