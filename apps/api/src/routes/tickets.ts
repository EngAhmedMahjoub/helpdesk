import { Router } from 'express'
import {
  type TicketListResponse,
  type TicketSummary,
  listTicketsQuerySchema,
} from '@helpdesk/shared'
import { prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'
import { parseQuery } from '../http.ts'

/** The columns the list exposes. Explicit, so a column added later stays out until chosen. */
const summaryFields = {
  id: true,
  subject: true,
  studentEmail: true,
  studentName: true,
  status: true,
  category: true,
  needsAgent: true,
  escalationReason: true,
  createdAt: true,
  updatedAt: true,
} as const

function toSummary(
  ticket: Prisma.TicketGetPayload<{ select: typeof summaryFields }>,
): TicketSummary {
  return {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  }
}

export const ticketsRouter = Router()

// Every ticket route is for agents and admins alike, so the guard sits on the
// router: a route added later cannot be left open by forgetting it.
ticketsRouter.use(requireAuth)

ticketsRouter.get('/', async (req, res) => {
  const query = parseQuery(listTicketsQuerySchema, req, res)
  if (!query) return

  const where: Prisma.TicketWhereInput = { status: query.status, category: query.category }

  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      select: summaryFields,
      // id breaks ties in the same direction: tickets created in one statement
      // share a timestamp, and an order that reshuffles between requests would
      // move a ticket from one page to the next.
      orderBy: [{ [query.sort]: query.order }, { id: query.order }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ])

  const body: TicketListResponse = {
    tickets: tickets.map(toSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
  res.json(body)
})
