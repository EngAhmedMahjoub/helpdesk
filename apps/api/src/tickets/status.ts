import type { TicketStatus } from '@helpdesk/shared'
import type { Prisma } from '../generated/prisma/client.ts'

/** How long a Resolved ticket waits before auto-close sets it Closed. */
export const AUTO_CLOSE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The columns to write when a ticket's status is set. Every status change goes
 * through here — an agent's, the AI's, auto-close's — so the timer can never
 * disagree with the status: only a Resolved ticket has an autoCloseAt, and
 * setting Resolved always starts it afresh.
 *
 * `now` is a parameter so tests, and callers resolving a ticket as of an
 * earlier moment, can fix it.
 */
export function statusChange(
  status: TicketStatus,
  now: Date = new Date(),
): { status: TicketStatus; autoCloseAt: Date | null } {
  return {
    status,
    autoCloseAt: status === 'resolved' ? new Date(now.getTime() + AUTO_CLOSE_AFTER_MS) : null,
  }
}

/**
 * Resolves the ticket if it is still Open, starting its auto-close timer, as a
 * reply that answers it does: the AI's, or an approved draft's.
 *
 * The status is the statement's own condition rather than read beforehand, so
 * an agent who closed or resolved the ticket while the reply was on its way is
 * not undone: a Resolved or Closed ticket keeps its status, and its timer.
 */
export async function resolveIfOpen(tx: Prisma.TransactionClient, ticketId: number) {
  await tx.ticket.updateMany({
    where: { id: ticketId, status: 'open' },
    data: statusChange('resolved'),
  })
}
