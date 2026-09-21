import { Router, type Response } from 'express'
import {
  MESSAGE_PAGE_SIZE,
  type TicketDetail,
  type TicketListResponse,
  type TicketMessage,
  type TicketSummary,
  createReplySchema,
  listTicketsQuerySchema,
  ticketIdSchema,
  updateTicketSchema,
} from '@helpdesk/shared'
import { isPrismaError, prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'
import { ticketWriteRateLimit } from '../auth/rate-limit.ts'
import { parseBody, parseId, parseQuery } from '../http.ts'
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

// Explicit: emailMessageId is plumbing for threading, and an agent is named
// by id and name only, never the rest of their row.
const messageFields = {
  id: true,
  direction: true,
  author: true,
  agent: { select: { id: true, name: true } },
  body: true,
  createdAt: true,
} satisfies Prisma.MessageSelect

function toMessage(
  message: Prisma.MessageGetPayload<{ select: typeof messageFields }>,
): TicketMessage {
  return { ...message, createdAt: message.createdAt.toISOString() }
}

/** A ticket with its thread, for the detail view and as the answer to a change. */
const detailFields = {
  ...summaryFields,
  summary: true,
  autoCloseAt: true,
  messages: {
    select: messageFields,
    // Capped: a thread is read back whole, and nothing bounds how many messages
    // one can hold — a student mailing in all day, or an agent replying in a
    // loop. The newest are the ones being worked on, so an over-long thread
    // loses its oldest here; MESSAGE_PAGE_SIZE says as much to the reader.
    take: MESSAGE_PAGE_SIZE,
    // Newest first so the cap keeps the newest; the handler turns them back
    // the way a thread reads. id breaks ties as on the list.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
} satisfies Prisma.TicketSelect

function toDetail(ticket: Prisma.TicketGetPayload<{ select: typeof detailFields }>): TicketDetail {
  const { summary, autoCloseAt, messages, ...rest } = ticket
  return {
    ...toSummary(rest),
    summary,
    autoCloseAt: autoCloseAt?.toISOString() ?? null,
    // Selected newest first for the cap; a thread reads the other way.
    messages: messages.map(toMessage).reverse(),
  }
}

const TICKET_NOT_FOUND = 'Ticket not found'

/**
 * Answers 404 when Prisma reports the row was not there, and says whether it
 * did; the caller rethrows anything else. A ticket can be deleted between the
 * id check and the write.
 */
function answered404(err: unknown, res: Response): boolean {
  if (!isPrismaError(err, 'P2025')) return false
  res.status(404).json({ error: TICKET_NOT_FOUND })
  return true
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

ticketsRouter.get('/:id', async (req, res) => {
  // undefined, not falsy: an id is a number, and 0 would read as absent.
  const id = parseId(ticketIdSchema, req, res, TICKET_NOT_FOUND)
  if (id === undefined) return

  const ticket = await prisma.ticket.findUnique({ where: { id }, select: detailFields })

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

  const id = parseId(ticketIdSchema, req, res, TICKET_NOT_FOUND)
  if (id === undefined) return

  try {
    const ticket = await prisma.ticket.update({
      where: { id },
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
    if (answered404(err, res)) return
    throw err
  }
})

ticketsRouter.post('/:id/replies', ticketWriteRateLimit, async (req, res) => {
  const body = parseBody(createReplySchema, req, res)
  if (!body) return

  const id = parseId(ticketIdSchema, req, res, TICKET_NOT_FOUND)
  if (id === undefined) return

  // requireAuth put the user there; the reply is theirs, whatever the body
  // says. Answered rather than defaulted: an empty id would reach the foreign
  // key and surface as a 500 where 401 is the honest answer.
  const agentId = req.user?.id
  if (!agentId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const message = await prisma.$transaction(async (tx) => {
      // A reply is activity on the ticket, so it moves up a list sorted by
      // updatedAt. Inserting a message does not touch the ticket row by itself.
      // The update also answers P2025 for a ticket that is not there.
      await tx.ticket.update({ where: { id }, data: { updatedAt: new Date() } })

      return tx.message.create({
        data: {
          ticketId: id,
          direction: 'outbound',
          author: 'agent',
          agentId,
          body: body.body,
          // Null until Phase 4 sends it: the Message-ID is the email's, and
          // there is no email yet.
          emailMessageId: null,
        },
        select: messageFields,
      })
    })

    res.status(201).json(toMessage(message))
  } catch (err) {
    if (answered404(err, res)) return
    throw err
  }
})
