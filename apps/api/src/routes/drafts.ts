import { Router } from 'express'
import {
  DRAFT_LIST_MAX,
  type DraftListResponse,
  type DraftSummary,
  listDraftsQuerySchema,
} from '@helpdesk/shared'
import { prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { requireAuth } from '../auth/middleware.ts'
import { parseQuery } from '../http.ts'

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
