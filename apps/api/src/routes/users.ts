import { Router } from 'express'
import type { UserSummary } from '@helpdesk/shared'
import { prisma } from '../db.ts'
import { requireAdmin, requireAuth } from '../auth/middleware.ts'

export const usersRouter = Router()

// Guards on the router rather than each route: 2.2 and 2.3 add more admin-only
// routes here, and a route added without its own guard would otherwise be open.
usersRouter.use(requireAuth, requireAdmin)

usersRouter.get('/', async (_req, res) => {
  // An explicit select, not an omit of passwordHash: a column added later is
  // then absent from the response until someone chooses to expose it.
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    // Oldest first, so the seeded admin heads the list and a newly created
    // agent lands at the end where the admin who just created it will look. id
    // breaks ties: rows inserted in one statement share a timestamp, and an
    // order that reshuffles between requests makes the list jump.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const body: UserSummary[] = users.map((user) => ({
    ...user,
    createdAt: user.createdAt.toISOString(),
  }))
  res.json(body)
})
