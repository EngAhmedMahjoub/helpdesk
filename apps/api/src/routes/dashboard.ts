import { Router } from 'express'
import {
  type DashboardResponse,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from '@helpdesk/shared'
import { prisma } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'

export const dashboardRouter = Router()

// Agents and admins alike: both work the tickets these counts are about.
dashboardRouter.use(requireAuth)

/**
 * Ticket counts by status and by category, and how many need an agent (7.1).
 *
 * Repeatable read, so the three queries count the same tickets: under Postgres's
 * default each sees its own snapshot, and a ticket arriving between them would
 * leave the categories summing to one more than the statuses.
 */
dashboardRouter.get('/', async (_req, res) => {
  const [statuses, categories, needsAgent] = await prisma.$transaction(
    [
      prisma.ticket.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      prisma.ticket.groupBy({
        by: ['category'],
        _count: { _all: true },
        orderBy: { category: 'asc' },
      }),
      prisma.ticket.count({ where: { needsAgent: true } }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )

  const byStatus = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<
    TicketStatus,
    number
  >
  for (const group of statuses) byStatus[group.status] = group._count._all

  const byCategory = Object.fromEntries(TICKET_CATEGORIES.map((c) => [c, 0])) as Record<
    TicketCategory,
    number
  >
  let uncategorized = 0
  for (const group of categories) {
    if (group.category === null) uncategorized = group._count._all
    else byCategory[group.category] = group._count._all
  }

  const body: DashboardResponse = {
    total: statuses.reduce((sum, group) => sum + group._count._all, 0),
    byStatus,
    byCategory,
    uncategorized,
    needsAgent,
  }
  res.json(body)
})
