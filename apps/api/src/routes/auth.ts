import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { verifyPassword } from '../auth/password.ts'
import { createSession, setSessionCookie } from '../auth/session.ts'

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
  res.json({ id: user.id, email: user.email, role: user.role })
})
