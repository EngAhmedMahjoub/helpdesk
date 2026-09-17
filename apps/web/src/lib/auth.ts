import type { CurrentUser } from '@helpdesk/shared'
import { ApiError, apiFetch } from '@/lib/api'

export type Credentials = {
  email: string
  password: string
}

/** The one query key the signed-in user is cached under. */
export const currentUserQueryKey = ['currentUser']

/**
 * Exchanges credentials for a session. The token itself arrives as an httpOnly
 * cookie the API sets, so there is nothing for the client to store.
 */
export function login(credentials: Credentials): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

/**
 * Resolves to `null` rather than throwing when nobody is signed in: being
 * logged out is an ordinary state the app renders, not a failure to report.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiFetch<CurrentUser>('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' })
}
