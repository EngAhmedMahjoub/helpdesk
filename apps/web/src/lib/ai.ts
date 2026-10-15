import type { PolishRequest, PolishResponse } from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/** Asks Claude to tidy an agent's text. Nothing is saved or sent; the API answers the new text. */
export function polishText(request: PolishRequest): Promise<PolishResponse> {
  return apiRequest<PolishResponse>('/ai/polish', { method: 'POST', data: request })
}
