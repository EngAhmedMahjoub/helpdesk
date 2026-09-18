import type request from 'supertest'
import type { Role } from '@helpdesk/shared'
import { hashPassword } from '../src/auth/password.ts'
import { SESSION_COOKIE, createSession } from '../src/auth/session.ts'
import { prisma } from './db.ts'

/** Long enough for the API's password rules, for any test that signs in with one. */
export const TEST_PASSWORD = 'a-long-enough-password'

export type NewUser = {
  email?: string
  name?: string
  role?: Role
  isActive?: boolean
  isProtected?: boolean
  /** Hashed and stored when given, so the user can sign in with it. */
  password?: string
}

/**
 * A user row, named and addressed after its role unless told otherwise. Every
 * test file truncates first, so the fixed defaults cannot collide across files.
 */
export async function createUser(overrides: NewUser = {}) {
  const role = overrides.role ?? 'agent'
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role}@example.com`,
      name: overrides.name ?? role,
      // Only hashed when a test will sign in with it: argon2 costs ~100ms a
      // user, and most tests never verify a password.
      passwordHash:
        overrides.password === undefined ? 'not-used-here' : await hashPassword(overrides.password),
      role,
      isActive: overrides.isActive ?? true,
      isProtected: overrides.isProtected ?? false,
    },
  })
}

/** A Cookie header carrying this session token. */
export const cookieHeader = (token: string) => `${SESSION_COOKIE}=${token}`

/** A Cookie header for a fresh session of this user, without going through login. */
export async function sessionCookieFor(userId: string) {
  return cookieHeader(await createSession(userId))
}

function setCookies(res: request.Response): string[] {
  // Supertest types headers as strings, but set-cookie really is an array.
  return (res.headers['set-cookie'] as string[] | undefined) ?? []
}

/** The session cookie a response sets, attributes included, if it sets one. */
export function sessionCookieFrom(res: request.Response): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))
}

/** True when the response tells the browser to drop the session cookie. */
export function clearsSessionCookie(res: request.Response): boolean {
  return setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`))
}
