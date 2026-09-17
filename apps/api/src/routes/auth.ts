import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { verifyAgainstDummyHash, verifyPassword } from '../auth/password.ts'
import { requireAuth } from '../auth/middleware.ts'
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
} from '../auth/session.ts'

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const body = loginSchema.safeParse(req.body)

  if (!body.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { email: body.data.email.toLowerCase() },
  })

  // Always one argon2 verification, even with no account to check against, so
  // the reply takes the same time whichever way it fails. Short-circuiting here
  // would answer an unknown address in about 2ms and a real one in about 110ms,
  // which tells an attacker which addresses exist however uniform the body is.
  const passwordMatches = user
    ? await verifyPassword(body.data.password, user.passwordHash)
    : await verifyAgainstDummyHash(body.data.password)

  // One response for an unknown email, a wrong password, and a deactivated
  // account, so the endpoint never reveals which addresses have accounts.
  if (!user || !user.isActive || !passwordMatches) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  setSessionCookie(res, await createSession(user.id))
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role })
})

/**
 * Deliberately unauthenticated: logging out must work even when the session is
 * already expired or unknown, so a client can always get back to a clean state.
 * The response is the same either way, so it reveals nothing about the token.
 */
authRouter.post('/logout', async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE]

  if (typeof token === 'string' && token.length > 0) {
    await deleteSession(token)
  }

  clearSessionCookie(res)
  res.status(204).end()
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})
