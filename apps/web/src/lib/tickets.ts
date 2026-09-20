import type {
  ListTicketsQuery,
  TicketDetail,
  TicketListResponse,
  UpdateTicketRequest,
} from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/**
 * The key a page of tickets is cached under. The query is part of it, so each
 * combination of filters, sort and page is its own cache entry and going back
 * to one already seen shows it at once.
 */
export const ticketsQueryKey = (query: ListTicketsQuery) => ['tickets', query] as const

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
