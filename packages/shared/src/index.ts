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
  name: string
  role: Role
}

/** A user as the admin user list shows them. `passwordHash` is never included. */
export type UserSummary = {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  /** The seeded admin. The API refuses to deactivate them. */
  isProtected: boolean
  createdAt: string
}

/** The body of `POST /api/users`. The role is not sent: the API only creates agents. */
export type CreateUserRequest = {
  email: string
  name: string
  password: string
}

/**
 * The body of `PATCH /api/users/:id`: any of these, at least one. Deactivating
 * ends every session the user holds, and so does setting their password, except
 * the one an admin changes their own from.
 */
export type UpdateUserRequest = {
  name?: string
  email?: string
  password?: string
  isActive?: boolean
}

export { authorise, type Change, type Party, type Verdict } from './user-permissions.ts'
