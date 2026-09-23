import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/hooks/use-auth'
import type {
  CreateReplyRequest,
  ListTicketsQuery,
  TicketDetail,
  UpdateTicketRequest,
} from '@helpdesk/shared'
import {
  assigneesQueryKey,
  createReply,
  fetchAssignees,
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
  // RequireAuth holds this page until the session check answers, so the id is
  // there by the time the list mounts.
  const viewerId = useCurrentUser().data?.id

  return useQuery({
    queryKey: ticketsQueryKey(query, viewerId),
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

/** The active agents and admins a ticket can be handed to, by name. */
export function useAssignees() {
  return useQuery({ queryKey: assigneesQueryKey, queryFn: fetchAssignees })
}

/**
 * Changes a ticket's status, category, escalation or assignee. The API answers with the
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
