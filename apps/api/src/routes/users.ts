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
  isProtected: true,
  createdAt: true,
} as const

function toSummary(user: {
  id: string
  email: string
  name: string
  role: UserSummary['role']
  isActive: boolean
  isProtected: boolean
  createdAt: Date
}): UserSummary {
  return { ...user, createdAt: user.createdAt.toISOString() }
}

const createUserSchema = z.object({
  // 254 is the longest address SMTP can deliver to. Without a cap, a few KB
  // overflowed the unique index's 2704-byte row limit: Postgres refused the
  // insert and the admin got a 500, after argon2 had already been paid for.
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  // 12 to match ADMIN_PASSWORD in the seed script, so the admin an agent is
  // created by cannot hold a weaker password than the agent. The cap keeps a
  // 100KB body — what express.json() allows — out of argon2.
  password: z.string().min(12).max(200),
})

// Only isActive: this route deactivates and reactivates. Name, email and
// password changes are their own decisions and are not in Phase 2.
const updateUserSchema = z.object({ isActive: z.boolean() })

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

usersRouter.patch('/:id', async (req, res) => {
  const body = updateUserSchema.safeParse(req.body)

  if (!body.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const id = req.params.id

  // A malformed id answers the same 404 as a well-formed one with no row: it
  // cannot name a user either way. Checked here only to answer early — User.id
  // is TEXT, so a malformed id would reach Postgres and simply miss.
  if (!z.uuid().safeParse(id).success) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  // An admin deactivating themselves is refused: it deletes the session making
  // the request, and with one admin there is then nobody left who can undo it.
  // Another admin can still deactivate them, so an admin is never unremovable.
  if (id === req.user?.id && !body.data.isActive) {
    res.status(409).json({ error: 'You cannot deactivate your own account' })
    return
  }

  // The seeded admin is never deactivated, by anyone. The self check above only
  // stops an admin locking themselves out; two admins deactivating each other at
  // the same moment would leave nobody who can manage users. Read outside the
  // transaction: only the seed ever sets the flag, so it cannot change under us.
  if (!body.data.isActive) {
    const target = await prisma.user.findUnique({ where: { id }, select: { isProtected: true } })
    if (target?.isProtected) {
      res.status(409).json({ error: 'This account cannot be deactivated' })
      return
    }
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: { isActive: true } })

      const updated = await tx.user.update({
        where: { id },
        data: { isActive: body.data.isActive },
        select: summaryFields,
      })

      // requireAuth already refuses an inactive user, so deleting sessions is
      // not what locks them out. It is what stops a reactivation handing back a
      // session nobody meant to issue.
      //
      // On reactivation too, not only deactivation. A login that read the user
      // as active before a deactivation committed, then spent its ~100ms in
      // argon2, inserts its session after the deactivation's delete. Refused
      // while the user is inactive, that row would come alive on reactivation.
      // Anyone who was inactive holds no session worth keeping. An already
      // active user is left alone: reactivating them must not sign them out.
      if (!body.data.isActive || before?.isActive === false) {
        await tx.session.deleteMany({ where: { userId: id } })
      }

      return updated
    })

    res.json(toSummary(user))
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'User not found' })
      return
    }
    throw err
  }
})
