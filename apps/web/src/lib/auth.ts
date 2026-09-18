import type { CurrentUser, LoginRequest } from '@helpdesk/shared'
import { apiRequest, isApiError } from '@/lib/api'

/** The one query key the signed-in user is cached under. */
export const currentUserQueryKey = ['currentUser']

/**
 * Exchanges credentials for a session. The token itself arrives as an httpOnly
 * cookie the API sets, so there is nothing for the client to store.
 */
export function login(credentials: LoginRequest): Promise<CurrentUser> {
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
    if (isApiError(error, 401)) return null
    throw error
  }
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' })
}
