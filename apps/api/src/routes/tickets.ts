import { Router, type Response } from 'express'
import {
  type Assignee,
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
import { EmailSendError } from '../email/outbound.ts'
import { outboundMessage, replyEmail } from '../email/reply-thread.ts'

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
  // Named like a message's agent: by id and name, never the rest of their row.
  assignee: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TicketSelect

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
  senderVerified: true,
  // One at most is pending; newest first all the same, should two ever be.
  replyDrafts: {
    where: { status: 'pending' },
    select: { id: true, body: true, createdAt: true, updatedAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
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
  const { summary, autoCloseAt, senderVerified, replyDrafts, messages, ...rest } = ticket
  const [draft] = replyDrafts
  return {
    ...toSummary(rest),
    summary,
    autoCloseAt: autoCloseAt?.toISOString() ?? null,
    senderVerified,
    pendingDraft: draft
      ? {
          ...draft,
          createdAt: draft.createdAt.toISOString(),
          updatedAt: draft.updatedAt.toISOString(),
        }
      : null,
    // Selected newest first for the cap; a thread reads the other way.
    messages: messages.map(toMessage).reverse(),
  }
}

const TICKET_NOT_FOUND = 'Ticket not found'

const REPLY_NOT_SENT = 'The reply could not be emailed. Nothing was saved; try again.'

// One answer for a user who does not exist and one who is deactivated: either
// way there is nobody to hand the ticket to, and the ticket screen shows the
// same thing for both.
const ASSIGNEE_UNAVAILABLE = 'Assign the ticket to an active user'

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

  // requireAuth put the user there. Answered rather than defaulted, as on
  // replies: an empty id would match nobody's tickets and read as "none yours".
  const userId = req.user?.id
  if (query.assignee === 'me' && !userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const where: Prisma.TicketWhereInput = {
    status: query.status,
    category: query.category,
    // undefined leaves the filter off; null matches the unassigned.
    assigneeId: query.assignee && (query.assignee === 'me' ? userId : null),
    // undefined leaves the filter off, as above (6.4).
    needsAgent: query.needsAgent && query.needsAgent === 'true',
  }

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

// Before /:id, which would otherwise take "assignees" for a malformed id.
// Here rather than on /api/users: that list is admin only and carries whole
// user rows, while anyone working a ticket needs to know who can take it.
ticketsRouter.get('/assignees', async (_req, res) => {
  const assignees: Assignee[] = await prisma.user.findMany({
    // The same users PATCH accepts: a deactivated one is refused there.
    where: { isActive: true },
    select: { id: true, name: true },
    // id breaks ties, so two people with one name keep their order.
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  res.json(assignees)
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

// Rate limited like a reply, and out of the same budget: since 3.13a a change
// costs a locked read and a write, and this is the route an assignment storm
// from one stolen session would use.
ticketsRouter.patch('/:id', ticketWriteRateLimit, async (req, res) => {
  // Body first, as on PATCH /api/users/:id: a malformed body is a 400 whatever
  // the id names.
  const body = parseBody(updateTicketSchema, req, res)
  if (!body) return

  const id = parseId(ticketIdSchema, req, res, TICKET_NOT_FOUND)
  if (id === undefined) return

  try {
    const ticket = await prisma.$transaction(async (tx) => {
      // null clears the assignee and needs no user; only a named one is checked.
      if (body.assigneeId) {
        // Raw, and the only raw SQL in this app, because Prisma cannot ask for
        // FOR UPDATE. Checking without the lock left a window: a deactivation
        // committing between the check and the update had already cleared the
        // user's tickets, so this write handed the ticket to someone who can no
        // longer sign in and who matches neither assignee filter — a ticket
        // nobody could find. A plain transaction does not close it either; at
        // READ COMMITTED the unlocked read still sees the pre-deactivation row.
        // The id is a UUID by updateTicketSchema, and the template parameterises
        // it rather than pasting it into the statement.
        const active = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "User" WHERE id = ${body.assigneeId} AND "isActive" FOR UPDATE
        `
        if (active.length === 0) return null
      }

      return tx.ticket.update({
        where: { id },
        data: {
          // undefined leaves the assignee as it is; null takes it away.
          assigneeId: body.assigneeId,
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
    })

    if (!ticket) {
      res.status(400).json({ error: ASSIGNEE_UNAVAILABLE })
      return
    }
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

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { subject: true, studentEmail: true },
  })
  if (!ticket) {
    res.status(404).json({ error: TICKET_NOT_FOUND })
    return
  }

  // Emailed before it is saved (task 4.3). The other order can leave a reply in
  // the thread that the student never received, with nothing to show it; this
  // way a failed send saves nothing, and the agent sees the error and resends.
  try {
    await req.app.locals.sendEmail(await replyEmail({ id, ...ticket }, body.body))
  } catch (err) {
    // Only a refusal from Resend is a 502. Anything else is a fault of ours,
    // and the error handler's 500 is the honest answer for it.
    if (!(err instanceof EmailSendError)) throw err
    console.error(err.message)
    res.status(502).json({ error: REPLY_NOT_SENT })
    return
  }

  try {
    const message = await prisma.$transaction(async (tx) => {
      // A reply is activity on the ticket, so it moves up a list sorted by
      // updatedAt. Inserting a message does not touch the ticket row by itself.
      // The update also answers P2025 for a ticket deleted since the lookup.
      await tx.ticket.update({ where: { id }, data: { updatedAt: new Date() } })

      // The agent has answered, so the AI's pending draft would only be a
      // second, outdated answer waiting to be approved (#249). Rejected, with
      // this agent as its reviewer: they set it aside by writing their own.
      await tx.replyDraft.updateMany({
        where: { ticketId: id, status: 'pending' },
        data: { status: 'rejected', reviewedById: agentId, reviewedAt: new Date() },
      })

      return tx.message.create({
        data: outboundMessage({ ticketId: id, author: 'agent', agentId, body: body.body }),
        select: messageFields,
      })
    })

    res.status(201).json(toMessage(message))
  } catch (err) {
    if (answered404(err, res)) return
    throw err
  }
})
