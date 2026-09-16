export type HealthResponse = {
  status: 'ok' | 'error'
  database: 'up' | 'down'
  timestamp: string
}

export type Role = 'admin' | 'agent'

/** The authenticated caller, as attached to a request and returned by /api/auth/me. */
export type CurrentUser = {
  id: string
  email: string
  role: Role
}
