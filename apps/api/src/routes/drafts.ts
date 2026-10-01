import { Router } from 'express'
import {
  DRAFT_LIST_MAX,
  type DraftListResponse,
  type DraftSummary,
  approveDraftSchema,
  draftIdSchema,
  listDraftsQuerySchema,
} from '@helpdesk/shared'
import { isPrismaError, prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'
import { ticketWriteRateLimit } from '../auth/rate-limit.ts'
import { EmailSendError } from '../email/outbound.ts'
import { replySubject, replyThread } from '../email/reply-thread.ts'
import { parseBody, parseId, parseQuery } from '../http.ts'
import { statusChange } from '../tickets/status.ts'

const DRAFT_NOT_FOUND = 'Draft not found'
const DRAFT_ALREADY_REVIEWED = 'This draft has already been reviewed'
const REPLY_NOT_SENT = 'The reply could not be sent. Please try again.'

/**
 * The columns a draft list exposes. Explicit, as on tickets: the reviewer is
 * named by id and name, never the rest of their row, and the ticket carries
 * only what a reviewer judges the draft by.
 */
const draftFields = {
  id: true,
  body: true,
  status: true,
  reviewedBy: { select: { id: true, name: true } },
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  ticket: {
    select: {
      id: true,
      subject: true,
      studentEmail: true,
      studentName: true,
      category: true,
      escalationReason: true,
      senderVerified: true,
    },
  },
} satisfies Prisma.ReplyDraftSelect

function toSummary(
  draft: Prisma.ReplyDraftGetPayload<{ select: typeof draftFields }>,
): DraftSummary {
  return {
    ...draft,
    reviewedAt: draft.reviewedAt?.toISOString() ?? null,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

export const draftsRouter = Router()

// Agents and admins alike: reviewing the AI's drafts is the agents' work.
draftsRouter.use(requireAuth)

/**
 * The AI's drafts in one status (6.1). Pending ones oldest first, so the
 * student who has waited longest is at the top; reviewed ones most recently
 * reviewed first, since those are the ones anyone looks back for. id breaks
 * ties in the same direction, so the order never reshuffles between requests.
 */
draftsRouter.get('/', async (req, res) => {
  const query = parseQuery(listDraftsQuerySchema, req, res)
  if (!query) return

  const orderBy: Prisma.ReplyDraftOrderByWithRelationInput[] =
    query.status === 'pending'
      ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ reviewedAt: 'desc' }, { id: 'desc' }]

  const drafts = await prisma.replyDraft.findMany({
    where: { status: query.status },
    select: draftFields,
    orderBy,
    take: DRAFT_LIST_MAX,
  })

  const body: DraftListResponse = { drafts: drafts.map(toSummary) }
  res.json(body)
})

/**
 * Approves a pending draft and emails it to the student (6.2), as the agent
 * edited it or, with no body, as the AI wrote it. Answers the approved draft.
 *
 * Claimed before it is sent: one conditional update moves it from pending to
 * approved, so of two agents approving at once only one gets past it, and the
 * student is emailed once. A failed send puts it back to pending for another
 * try. The cost of this order is a crash between the claim and the send, which
 * leaves a draft marked approved that was never emailed; the other order's
 * cost, the same reply sent twice, is the one a student would see.
 *
 * Once sent it is the approving agent's reply: saved as their message, the
 * ticket no longer needs an agent, and an Open ticket is resolved as an AI
 * reply would have resolved it.
 */
draftsRouter.post('/:id/approve', ticketWriteRateLimit, async (req, res) => {
  const body = parseBody(approveDraftSchema, req, res)
  if (!body) return

  const id = parseId(draftIdSchema, req, res, DRAFT_NOT_FOUND)
  if (id === undefined) return

  // requireAuth put the user there. Answered rather than defaulted, as on
  // replies: the reviewer is a foreign key, and an empty one is a 500.
  const reviewerId = req.user?.id
  if (!reviewerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const draft = await prisma.replyDraft.findUnique({
    where: { id },
    select: { body: true, ticket: { select: { id: true, subject: true, studentEmail: true } } },
  })
  if (!draft) {
    res.status(404).json({ error: DRAFT_NOT_FOUND })
    return
  }

  const text = body.body ?? draft.body
  const { count } = await prisma.replyDraft.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'approved', body: text, reviewedById: reviewerId, reviewedAt: new Date() },
  })
  if (count === 0) {
    res.status(409).json({ error: DRAFT_ALREADY_REVIEWED })
    return
  }

  const { ticket } = draft
  try {
    // Not marked automatic: a person approved it, and an auto-responder that
    // writes back to it is answering someone.
    await req.app.locals.sendEmail({
      to: ticket.studentEmail,
      subject: replySubject(ticket.subject),
      text,
      thread: await replyThread(ticket.id),
    })
  } catch (err) {
    // Back to pending, the edit kept, so the agent can try again. Conditional
    // on this claim, so nothing a later approval wrote is undone.
    await prisma.replyDraft.updateMany({
      where: { id, status: 'approved', reviewedById: reviewerId },
      data: { status: 'pending', reviewedById: null, reviewedAt: null },
    })
    if (!(err instanceof EmailSendError)) throw err
    console.error(err.message)
    res.status(502).json({ error: REPLY_NOT_SENT })
    return
  }

  let approved
  try {
    approved = await prisma.$transaction(async (tx) => {
      // First, so a ticket deleted since the lookup fails here as P2025.
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { needsAgent: false, escalationReason: null },
      })
      await tx.message.create({
        data: {
          ticketId: ticket.id,
          direction: 'outbound',
          author: 'agent',
          agentId: reviewerId,
          body: text,
          emailMessageId: null,
        },
      })
      // The status is the update's own condition, as on the AI's replies: a
      // Resolved or Closed ticket keeps its status, and its timer.
      await tx.ticket.updateMany({
        where: { id: ticket.id, status: 'open' },
        data: statusChange('resolved'),
      })
      return tx.replyDraft.findUniqueOrThrow({ where: { id }, select: draftFields })
    })
  } catch (err) {
    // The ticket, and with it the draft, deleted since the lookup. The email
    // has gone; there is nothing left to record it on.
    if (isPrismaError(err, 'P2025')) {
      res.status(404).json({ error: DRAFT_NOT_FOUND })
      return
    }
    throw err
  }

  res.json(toSummary(approved))
})
