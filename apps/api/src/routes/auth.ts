import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { verifyPassword } from '../auth/password.ts'
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

  // One response for an unknown email, a wrong password, and a deactivated
  // account, so the endpoint never reveals which addresses have accounts.
  if (!user || !user.isActive || !(await verifyPassword(body.data.password, user.passwordHash))) {
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
