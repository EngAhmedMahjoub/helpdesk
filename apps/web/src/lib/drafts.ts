import type { ApproveDraftRequest, DraftSummary } from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/** Approves a pending draft, as edited, and emails it. The API answers with the approved draft. */
export function approveDraft(id: number, request: ApproveDraftRequest): Promise<DraftSummary> {
  return apiRequest<DraftSummary>(`/drafts/${String(id)}/approve`, {
    method: 'POST',
    data: request,
  })
}

/** Rejects a pending draft; nothing is emailed. The API answers with the rejected draft. */
export function rejectDraft(id: number): Promise<DraftSummary> {
  return apiRequest<DraftSummary>(`/drafts/${String(id)}/reject`, { method: 'POST' })
}
