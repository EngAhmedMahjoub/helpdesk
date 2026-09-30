import { createHash, timingSafeEqual } from 'node:crypto'
import { type RequestHandler, Router } from 'express'
import { prisma } from '../db.ts'
import { env } from '../env.ts'
import { statusChange } from '../tickets/status.ts'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Lets through only a caller holding `TASKS_SECRET`, sent as a bearer token.
 * No session: the caller is the scheduled GitHub Actions workflow, since the
 * API sleeps when idle and cannot schedule anything itself.
 *
 * Both sides are hashed before comparing so the lengths always match, which
 * timingSafeEqual requires, and a wrong guess learns nothing from the time it
 * took, not even the secret's length. Every refusal is the same 401.
 */
const requireTaskSecret: RequestHandler = (req, res, next) => {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!timingSafeEqual(digest(token), digest(env.TASKS_SECRET))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

export const tasksRouter = Router()

tasksRouter.use(requireTaskSecret)

/**
 * Closes every Resolved ticket whose 14-day timer has run out (5.16). The
 * status and the timer are the statement's own condition, so a ticket an
 * agent reopened, or a student's reply restarted, since it was last looked at
 * is left alone. Safe to call twice: a closed ticket no longer matches.
 */
tasksRouter.post('/auto-close', async (_req, res) => {
  const now = new Date()
  const { count } = await prisma.ticket.updateMany({
    where: { status: 'resolved', autoCloseAt: { lte: now } },
    data: statusChange('closed', now),
  })
  console.log(`Auto-close: ${String(count)} ticket(s) closed`)
  res.json({ closed: count })
})

/**
 * Deletes every expired session (5.16a). requireAuth already refuses them, so
 * this is housekeeping: a row outliving its session is a token hash nobody
 * can use, kept for no reason. Expired means what requireAuth takes it to
 * mean, `expiresAt` at or before now, so the two never disagree about a
 * session on the boundary.
 */
tasksRouter.post('/cleanup-sessions', async (_req, res) => {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  console.log(`Session cleanup: ${String(count)} session(s) deleted`)
  res.json({ deleted: count })
})
