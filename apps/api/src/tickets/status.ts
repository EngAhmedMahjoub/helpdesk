import type { TicketStatus } from '@helpdesk/shared'

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
