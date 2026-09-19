import { Router } from 'express'
import {
  type TicketDetail,
  type TicketListResponse,
  type TicketSummary,
  listTicketsQuerySchema,
  ticketIdSchema,
  updateTicketSchema,
} from '@helpdesk/shared'
import { isPrismaError, prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'
import { parseBody, parseQuery } from '../http.ts'
import { statusChange } from '../tickets/status.ts'

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

/** A ticket with its thread, for the detail view and as the answer to a change. */
const detailFields = {
  ...summaryFields,
  summary: true,
  autoCloseAt: true,
  messages: {
    // Explicit here too: emailMessageId is plumbing for threading, and an
    // agent is named by id and name only, never the rest of their row.
    select: {
      id: true,
      direction: true,
      author: true,
      agent: { select: { id: true, name: true } },
      body: true,
      createdAt: true,
    },
    // Oldest first, as a thread reads; id breaks ties as on the list.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TicketSelect

function toDetail(ticket: Prisma.TicketGetPayload<{ select: typeof detailFields }>): TicketDetail {
  const { summary, autoCloseAt, messages, ...rest } = ticket
  return {
    ...toSummary(rest),
    summary,
    autoCloseAt: autoCloseAt?.toISOString() ?? null,
    messages: messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  }
}

const TICKET_NOT_FOUND = 'Ticket not found'

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

ticketsRouter.get('/:id', async (req, res) => {
  // A malformed id answers the same 404 as a well-formed one with no row: it
  // cannot name a ticket either way.
  const id = ticketIdSchema.safeParse(req.params.id)
  if (!id.success) {
    res.status(404).json({ error: TICKET_NOT_FOUND })
    return
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: id.data }, select: detailFields })

  if (!ticket) {
    res.status(404).json({ error: TICKET_NOT_FOUND })
    return
  }

  res.json(toDetail(ticket))
})

ticketsRouter.patch('/:id', async (req, res) => {
  // Body first, as on PATCH /api/users/:id: a malformed body is a 400 whatever
  // the id names.
  const body = parseBody(updateTicketSchema, req, res)
  if (!body) return

  const id = ticketIdSchema.safeParse(req.params.id)
  if (!id.success) {
    res.status(404).json({ error: TICKET_NOT_FOUND })
    return
  }

  try {
    const ticket = await prisma.ticket.update({
      where: { id: id.data },
      data: {
        // autoCloseAt moves only with a status in the request: a category
        // change alone must not start or stop a Resolved ticket's timer.
        ...(body.status && statusChange(body.status)),
        category: body.category,
        // The reason only explains a set flag, so clearing the flag clears it:
        // a ticket no longer waiting for an agent has nothing to be escalated for.
        ...(body.needsAgent === false && { needsAgent: false, escalationReason: null }),
      },
      select: detailFields,
    })
    res.json(toDetail(ticket))
  } catch (err) {
    if (isPrismaError(err, 'P2025')) {
      res.status(404).json({ error: TICKET_NOT_FOUND })
      return
    }
    throw err
  }
})
