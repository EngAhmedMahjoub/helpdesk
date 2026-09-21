import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateReplyRequest,
  ListTicketsQuery,
  TicketDetail,
  UpdateTicketRequest,
} from '@helpdesk/shared'
import {
  createReply,
  fetchTicket,
  fetchTickets,
  ticketQueryKey,
  ticketsQueryKey,
  ticketsQueryKeyPrefix,
  updateTicket,
} from '@/lib/tickets'

/**
 * A page of tickets. The previous page stays on screen while the next one
 * loads, so paging or changing a filter does not blank the table and jump the
 * page back to the top.
 */
export function useTickets(query: ListTicketsQuery) {
  return useQuery({
    queryKey: ticketsQueryKey(query),
    queryFn: () => fetchTickets(query),
    placeholderData: keepPreviousData,
  })
}

/** One ticket with its thread. `id` is already parsed from the URL. */
export function useTicket(id: number) {
  return useQuery({
    queryKey: ticketQueryKey(id),
    queryFn: () => fetchTicket(id),
  })
}

/**
 * Changes a ticket's status, category or escalation. The API answers with the
 * whole ticket, so the detail cache takes that answer rather than refetching;
 * the lists are only invalidated, since the change may move the ticket between
 * filters and pages, which is the API's to decide.
 */
export function useUpdateTicket(id: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (changes: UpdateTicketRequest) => updateTicket(id, changes),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketQueryKey(id), ticket)
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKeyPrefix })
    },
  })
}

/**
 * Sends an agent's reply. The answer is the stored message, so it joins the
 * end of the cached thread at once; the ticket itself is refetched because the
 * reply moved its last-activity stamp, and the lists with it.
 */
export function useCreateReply(id: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateReplyRequest) => createReply(id, request),
    onSuccess: (message) => {
      queryClient.setQueryData(ticketQueryKey(id), (ticket: TicketDetail | undefined) =>
        ticket ? { ...ticket, messages: [...ticket.messages, message] } : ticket,
      )
      void queryClient.invalidateQueries({ queryKey: ticketQueryKey(id) })
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKeyPrefix })
    },
  })
}
