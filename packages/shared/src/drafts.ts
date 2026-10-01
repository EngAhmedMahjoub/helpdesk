import { z } from 'zod'
import type { Assignee, EscalationReason, TicketCategory } from './tickets.ts'

export const DRAFT_STATUSES = ['pending', 'approved', 'rejected'] as const

export type DraftStatus = (typeof DRAFT_STATUSES)[number]

/** The most drafts one list returns: one pending draft per ticket keeps the queue short. */
export const DRAFT_LIST_MAX = 100

/**
 * The query string of `GET /api/drafts`. `status` is required: the review queue
 * asks for `pending`, and a list with no status would mix drafts waiting on
 * someone with drafts already dealt with.
 */
export const listDraftsQuerySchema = z.object({
  status: z.enum(DRAFT_STATUSES),
})

export type ListDraftsQuery = z.input<typeof listDraftsQuerySchema>

/** One AI draft, with what a reviewer needs to know about its ticket. */
export type DraftSummary = {
  id: number
  body: string
  status: DraftStatus
  /** Who approved or rejected it; null while pending. */
  reviewedBy: Assignee | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
  ticket: {
    id: number
    subject: string
    studentEmail: string
    studentName: string | null
    category: TicketCategory | null
    escalationReason: EscalationReason | null
    /**
     * Whether the ticket's first email passed DMARC. When false, approving the
     * draft emails an address anyone could have forged (#239).
     */
    senderVerified: boolean
  }
}

export type DraftListResponse = {
  drafts: DraftSummary[]
}
