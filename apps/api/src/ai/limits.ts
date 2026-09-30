import type { PrismaClient } from '../generated/prisma/client.ts'

/**
 * How much the AI may do before a person takes over (#239, from the Phase 5
 * security review). None of these is reached by a real student with a real
 * question; they bound what someone scripting email can cost or send.
 *
 * Counted from rows that already exist, not a counter of their own: each
 * student message queues one job, so inbound messages stand for AI calls, and
 * each email the AI sends is saved as an `ai` message.
 */
export const AI_LIMITS = {
  /** AI calls one ticket may cause in 24 hours; past it, an agent answers. */
  callsPerTicketPerDay: 5,
  /** AI calls across every ticket in 24 hours: worst case about $5 a day. */
  callsPerDay: 500,
  /** Emails the AI may send on one ticket in 24 hours, so a mail loop stops. */
  sendsPerTicketPerDay: 3,
  /** Emails the AI may send across every ticket in an hour. */
  sendsPerHour: 50,
  /** Characters of thread the model reads, newest first: about 10,000 tokens. */
  promptCharacters: 40_000,
} as const

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Whether answering this ticket would pass a call budget. The ticket's own
 * newest message is among those counted, so the sixth in a day is the first
 * refused.
 */
export async function overCallBudget(
  prisma: PrismaClient,
  ticketId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - DAY)
  const inbound = { direction: 'inbound', createdAt: { gt: since } } as const
  const [onTicket, everywhere] = await Promise.all([
    prisma.message.count({ where: { ...inbound, ticketId } }),
    prisma.message.count({ where: inbound }),
  ])
  return onTicket > AI_LIMITS.callsPerTicketPerDay || everywhere > AI_LIMITS.callsPerDay
}

/** Whether the AI has already sent as much as it may, on this ticket or overall. */
export async function atSendLimit(
  prisma: PrismaClient,
  ticketId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const sent = { author: 'ai', direction: 'outbound' } as const
  const [onTicket, lastHour] = await Promise.all([
    prisma.message.count({
      where: { ...sent, ticketId, createdAt: { gt: new Date(now.getTime() - DAY) } },
    }),
    prisma.message.count({ where: { ...sent, createdAt: { gt: new Date(now.getTime() - HOUR) } } }),
  ])
  return onTicket >= AI_LIMITS.sendsPerTicketPerDay || lastHour >= AI_LIMITS.sendsPerHour
}

/**
 * The newest messages whose bodies fit in `budget` characters, still newest
 * first. The newest is always kept: it is what the job is answering, and
 * inbound bodies are capped at 20,000 characters, well inside the budget.
 *
 * By characters rather than a message count, since a count bounds nothing
 * when each message can be 20,000 characters (#239).
 */
export function withinBudget<T extends { body: string }>(
  newestFirst: T[],
  budget: number = AI_LIMITS.promptCharacters,
): T[] {
  const kept: T[] = []
  let used = 0
  for (const message of newestFirst) {
    if (kept.length > 0 && used + message.body.length > budget) break
    kept.push(message)
    used += message.body.length
  }
  return kept
}
