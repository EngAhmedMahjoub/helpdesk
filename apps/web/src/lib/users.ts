import type { CreateUserRequest, UpdateUserRequest, UserSummary } from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

/** The key the user list is cached under; creating or deactivating invalidates it. */
export const usersQueryKey = ['users']

export function fetchUsers(): Promise<UserSummary[]> {
  return apiRequest<UserSummary[]>('/users')
}

export function createUser(request: CreateUserRequest): Promise<UserSummary> {
  return apiRequest<UserSummary>('/users', { method: 'POST', data: request })
}

export function updateUser(id: string, request: UpdateUserRequest): Promise<UserSummary> {
  return apiRequest<UserSummary>(`/users/${id}`, { method: 'PATCH', data: request })
}
