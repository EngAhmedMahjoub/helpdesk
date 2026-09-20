import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListTicketsQuery } from '@helpdesk/shared'
import { fetchTickets, ticketsQueryKey } from '@/lib/tickets'

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
