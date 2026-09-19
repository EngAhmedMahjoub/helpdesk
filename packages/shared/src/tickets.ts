import { z } from 'zod'

export const TICKET_STATUSES = ['open', 'resolved', 'closed'] as const
export const TICKET_CATEGORIES = ['general', 'technical', 'refund'] as const
export const ESCALATION_REASONS = ['refund_approval', 'ai_failed'] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type EscalationReason = (typeof ESCALATION_REASONS)[number]

/** A ticket as the list shows it: no messages, summary or auto-close date. */
export type TicketSummary = {
  id: number
  subject: string
  studentEmail: string
  studentName: string | null
  status: TicketStatus
  category: TicketCategory | null
  needsAgent: boolean
  escalationReason: EscalationReason | null
  createdAt: string
  updatedAt: string
}

/** Postgres's largest INTEGER, the type of every ticket id. */
const MAX_TICKET_ID = 2_147_483_647

/**
 * A ticket id as it arrives in a URL. Digits only, so "1e2", " 5" and "0x10" —
 * all of which Number() would accept — are not ids; and no larger than the
 * column holds, so an oversized one is simply no ticket rather than a
 * database error.
 */
export const ticketIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine((id) => id <= MAX_TICKET_ID)

export const TICKET_PAGE_SIZE_MAX = 100

/**
 * The query string of `GET /api/tickets`. Every parameter is optional. By
 * default the most recently active tickets come first, 20 to a page.
 */
export const listTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  sort: z.enum(['createdAt', 'updatedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  // Coerced: a query string carries every value as text.
  page: z.coerce.number().int().min(1).default(1),
  // Capped, so one request cannot ask for the whole table.
  pageSize: z.coerce.number().int().min(1).max(TICKET_PAGE_SIZE_MAX).default(20),
})

/** What the page sends: every parameter may be left out. */
export type ListTicketsQuery = z.input<typeof listTicketsQuerySchema>

export type TicketListResponse = {
  tickets: TicketSummary[]
  page: number
  pageSize: number
  /** Tickets matching the filters across every page, for the page count. */
  total: number
}

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const
export const MESSAGE_AUTHORS = ['student', 'ai', 'agent'] as const

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number]
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number]

/** One message in a ticket's thread. */
export type TicketMessage = {
  id: number
  direction: MessageDirection
  author: MessageAuthor
  /** Who wrote an agent reply; null for student and AI messages. */
  agent: { id: string; name: string } | null
  body: string
  createdAt: string
}

/** The body of `GET /api/tickets/:id`: the ticket and its thread, oldest message first. */
export type TicketDetail = TicketSummary & {
  summary: string | null
  autoCloseAt: string | null
  messages: TicketMessage[]
}

/**
 * The body of `PATCH /api/tickets/:id`: any of these, at least one. An agent
 * may only clear needsAgent — setting it is the AI's escalation, not a choice
 * made from the ticket screen — and clearing it clears escalationReason too.
 * Anything else in the body is stripped, so a change of nothing is a 400.
 */
export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    needsAgent: z.literal(false).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined))

export type UpdateTicketRequest = z.infer<typeof updateTicketSchema>

/**
 * Generous for an email reply, and a bound on what one request can store: the
 * JSON body limit alone would let a single reply hold ~100KB.
 */
export const REPLY_MAX_LENGTH = 10_000

/**
 * The body of `POST /api/tickets/:id/replies`. Only the text: who wrote it is
 * the session's user, and a reply is always an outbound agent message.
 */
export const createReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a reply')
    .max(REPLY_MAX_LENGTH, `Keep the reply under ${REPLY_MAX_LENGTH} characters`),
})

export type CreateReplyRequest = z.infer<typeof createReplySchema>
