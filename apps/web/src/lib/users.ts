import type { UserSummary } from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/** The key the user list is cached under; 2.5 and 2.6 invalidate it. */
export const usersQueryKey = ['users']

export function fetchUsers(): Promise<UserSummary[]> {
  return apiRequest<UserSummary[]>('/users')
}
