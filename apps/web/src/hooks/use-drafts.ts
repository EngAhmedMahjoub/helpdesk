import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApproveDraftRequest } from '@helpdesk/shared'
import { approveDraft, rejectDraft } from '@/lib/drafts'
import { ticketQueryKey, ticketsQueryKeyPrefix } from '@/lib/tickets'

/**
 * After a review the ticket is refetched rather than patched: approval adds a
 * message, clears the escalation and may resolve it, and all of that is the
 * API's to say. The lists go too, since the ticket may leave a filter.
 */
function useAfterReview(ticketId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticketId) })
    void queryClient.invalidateQueries({ queryKey: ticketsQueryKeyPrefix })
  }
}

/** Approves the ticket's pending draft, as the agent edited it, and emails it. */
export function useApproveDraft(ticketId: number) {
  const afterReview = useAfterReview(ticketId)
  return useMutation({
    mutationFn: ({ draftId, ...request }: ApproveDraftRequest & { draftId: number }) =>
      approveDraft(draftId, request),
    onSuccess: afterReview,
  })
}

/** Rejects the ticket's pending draft. */
export function useRejectDraft(ticketId: number) {
  const afterReview = useAfterReview(ticketId)
  return useMutation({
    mutationFn: (draftId: number) => rejectDraft(draftId),
    onSuccess: afterReview,
  })
}
