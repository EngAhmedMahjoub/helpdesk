import type { CurrentUser, LoginRequest } from '@helpdesk/shared'
import { ApiError, apiRequest } from '@/lib/api'

export type Credentials = LoginRequest

/** The one query key the signed-in user is cached under. */
export const currentUserQueryKey = ['currentUser']

/**
 * Exchanges credentials for a session. The token itself arrives as an httpOnly
 * cookie the API sets, so there is nothing for the client to store.
 */
export function login(credentials: Credentials): Promise<CurrentUser> {
  // axios serialises the object and sets the JSON content type itself.
  return apiRequest<CurrentUser>('/auth/login', { method: 'POST', data: credentials })
}

/**
 * Resolves to `null` rather than throwing when nobody is signed in: being
 * logged out is an ordinary state the app renders, not a failure to report.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiRequest<CurrentUser>('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' })
}
