import { Router } from 'express'
import { loginSchema } from '@helpdesk/shared'
import { prisma } from '../db.ts'
import { verifyAgainstDummyHash, verifyPassword } from '../auth/password.ts'
import { requireAuth, toCurrentUser } from '../auth/middleware.ts'
import { loginRateLimit } from '../auth/rate-limit.ts'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  setSessionCookie,
} from '../auth/session.ts'
import { parseBody } from '../http.ts'

export const authRouter = Router()

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const body = parseBody(loginSchema, req, res)
  if (!body) return

  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
  })

  // Always one argon2 verification, even with no account to check against, so
  // the reply takes the same time whichever way it fails. Short-circuiting here
  // would answer an unknown address in about 2ms and a real one in about 110ms,
  // which tells an attacker which addresses exist however uniform the body is.
  const passwordMatches = user
    ? await verifyPassword(body.password, user.passwordHash)
    : await verifyAgainstDummyHash(body.password)

  // One response for an unknown email, a wrong password, and a deactivated
  // account, so the endpoint never reveals which addresses have accounts.
  if (!user || !user.isActive || !passwordMatches) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  setSessionCookie(res, await createSession(user.id))
  res.json(toCurrentUser(user))
})

/**
 * Deliberately unauthenticated: logging out must work even when the session is
 * already expired or unknown, so a client can always get back to a clean state.
 * The response is the same either way, so it reveals nothing about the token.
 */
authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req)
  if (token) await deleteSession(token)

  clearSessionCookie(res)
  res.status(204).end()
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})
