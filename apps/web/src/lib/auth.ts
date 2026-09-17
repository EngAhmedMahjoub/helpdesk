import type { CurrentUser } from '@helpdesk/shared'
import { apiFetch } from '@/lib/api'

export type Credentials = {
  email: string
  password: string
}

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
