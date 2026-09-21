import type {
  CreateReplyRequest,
  ListTicketsQuery,
  TicketDetail,
  TicketListResponse,
  TicketMessage,
  TicketSummary,
  UpdateTicketRequest,
} from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/**
 * Every page of tickets, whatever its filters: what a change to one ticket
 * invalidates.
 */
export const ticketsQueryKeyPrefix = ['tickets'] as const

/**
 * The key one page is cached under. The query is part of it, so each
 * combination of filters, sort and page is its own entry and going back to one
 * already seen shows it at once.
 */
export const ticketsQueryKey = (query: ListTicketsQuery) =>
  [...ticketsQueryKeyPrefix, query] as const

export function fetchTickets(query: ListTicketsQuery): Promise<TicketListResponse> {
  // params, not a hand-built query string: axios encodes the values, and
  // undefined ones are left out rather than sent empty.
  return apiRequest<TicketListResponse>('/tickets', { params: query })
}

/** The key one ticket's detail is cached under, keyed by its id. */
export const ticketQueryKey = (id: number) => ['ticket', id] as const

export function fetchTicket(id: number): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(`/tickets/${String(id)}`)
}

export function updateTicket(id: number, request: UpdateTicketRequest): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(`/tickets/${String(id)}`, { method: 'PATCH', data: request })
}

/** Saves an agent's reply. The API answers with the message it stored. */
export function createReply(id: number, request: CreateReplyRequest): Promise<TicketMessage> {
  return apiRequest<TicketMessage>(`/tickets/${String(id)}/replies`, {
    method: 'POST',
    data: request,
  })
}

/**
 * What to call a student: their name, or the address they wrote from when the
 * email carried no name.
 */
export const studentLabel = (ticket: Pick<TicketSummary, 'studentName' | 'studentEmail'>) =>
  ticket.studentName ?? ticket.studentEmail
