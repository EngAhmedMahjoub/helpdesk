import type { RequestHandler } from 'express'
import type { CurrentUser } from '@helpdesk/shared'
import { prisma } from '../db.ts'
import { SESSION_COOKIE, clearSessionCookie, hashToken } from './session.ts'

// Express exposes global Express.Request as the open interface applications
// extend; express-serve-static-core is not resolvable by bare name under Bun's
// node_modules layout.
declare global {
  namespace Express {
    interface Request {
      user?: CurrentUser
    }
  }
}

/**
 * Authenticates a request from the session cookie.
 *
 * Every rejection is the same 401 with the same body, so a caller cannot tell a
 * forged token from an expired one from a deactivated account. On rejection the
 * cookie is cleared, so a client holding a dead session stops sending it.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const reject = () => {
    clearSessionCookie(res)
    res.status(401).json({ error: 'Unauthorized' })
  }

  const token: unknown = req.cookies?.[SESSION_COOKIE]

  if (typeof token !== 'string' || token.length === 0) {
    reject()
    return
  }

  // Looked up by hash: the raw token is never stored, so it cannot be compared
  // directly. The unique index makes this a single indexed read.
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })

  if (!session) {
    reject()
    return
  }

  if (session.expiresAt <= new Date()) {
    // Drop it now rather than waiting for the cleanup task, so a replay of the
    // same token cannot keep hitting a row that is already dead.
    await prisma.session.delete({ where: { id: session.id } })
    reject()
    return
  }

  if (!session.user.isActive) {
    reject()
    return
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  }
  next()
}
