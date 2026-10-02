import type { TicketCategory, TicketStatus } from './tickets.ts'

/**
 * The body of `GET /api/dashboard`: ticket counts across every ticket, whatever
 * its status. Every status and category is present, at zero when no ticket has
 * it, so the page can list them without checking for gaps.
 */
export type DashboardResponse = {
  total: number
  byStatus: Record<TicketStatus, number>
  byCategory: Record<TicketCategory, number>
  /** Tickets neither the AI nor an agent has classified yet. */
  uncategorized: number
  /** The same tickets `GET /api/tickets?needsAgent=true` lists. */
  needsAgent: number
}
