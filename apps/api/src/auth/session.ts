import { createHash, randomBytes } from 'node:crypto'
import type { Response } from 'express'
import { prisma } from '../db.ts'
import { env } from '../env.ts'

export const SESSION_COOKIE = 'session'
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000

/** The raw token lives only in the cookie; the database stores this hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Creates a session row and returns the raw token for the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })

  return token
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure would make the cookie unusable over plain HTTP in local development.
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  })
}
