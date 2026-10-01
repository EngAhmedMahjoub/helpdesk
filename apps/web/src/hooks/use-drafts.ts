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

/**
 * Approves the ticket's pending draft, as the agent edited it, and emails it.
 *
 * A refusal refetches too. A 409 may mean the AI rewrote the draft, whose new
 * version the panel should then show; after a failed send the API has put the
 * draft back with a new version, which the next try must carry.
 */
export function useApproveDraft(ticketId: number) {
  const afterReview = useAfterReview(ticketId)
  return useMutation({
    mutationFn: ({ draftId, ...request }: ApproveDraftRequest & { draftId: number }) =>
      approveDraft(draftId, request),
    onSuccess: afterReview,
    onError: afterReview,
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
