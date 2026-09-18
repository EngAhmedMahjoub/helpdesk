import { Router } from 'express'
import { z } from 'zod'
import type { UserSummary } from '@helpdesk/shared'
import { prisma } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { hashPassword } from '../auth/password.ts'
import { requireAdmin, requireAuth } from '../auth/middleware.ts'

/** The columns a user list or a creation response may expose. Never the hash. */
const summaryFields = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const

function toSummary(user: {
  id: string
  email: string
  name: string
  role: UserSummary['role']
  isActive: boolean
  createdAt: Date
}): UserSummary {
  return { ...user, createdAt: user.createdAt.toISOString() }
}

const createUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  // 12 to match ADMIN_PASSWORD in the seed script, so the admin an agent is
  // created by cannot hold a weaker password than the agent. The cap keeps a
  // 100KB body — what express.json() allows — out of argon2.
  password: z.string().min(12).max(200),
})

export const usersRouter = Router()

// Guards on the router rather than each route: 2.2 and 2.3 add more admin-only
// routes here, and a route added without its own guard would otherwise be open.
usersRouter.use(requireAuth, requireAdmin)

usersRouter.get('/', async (_req, res) => {
  // An explicit select, not an omit of passwordHash: a column added later is
  // then absent from the response until someone chooses to expose it.
  const users = await prisma.user.findMany({
    select: summaryFields,
    // Oldest first, so the seeded admin heads the list and a newly created
    // agent lands at the end where the admin who just created it will look. id
    // breaks ties: rows inserted in one statement share a timestamp, and an
    // order that reshuffles between requests makes the list jump.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  res.json(users.map(toSummary))
})

usersRouter.post('/', async (req, res) => {
  const body = createUserSchema.safeParse(req.body)

  if (!body.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  // Lowercased on the way in because login looks the address up lowercased. A
  // row stored with capitals would be unreachable: the agent could never sign in.
  const email = body.data.email.toLowerCase()

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: body.data.name,
        passwordHash: await hashPassword(body.data.password),
        // Fixed, never read from the body. This endpoint creates agents; taking
        // the role from the request would turn one stolen admin session into a
        // permanent second admin account.
        role: 'agent',
      },
      select: summaryFields,
    })

    res.status(201).json(toSummary(user))
  } catch (err) {
    // The unique index decides, not a findUnique beforehand: two admins posting
    // the same address at once would both pass a check-then-insert and one
    // would get a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'A user with that email already exists' })
      return
    }
    throw err
  }
})
