import { Router } from 'express'
import { z } from 'zod'
import { type UserSummary, authorise, createUserSchema, updateUserSchema } from '@helpdesk/shared'
import { isPrismaError, prisma } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { hashPassword } from '../auth/password.ts'
import { requireAdmin, requireAuth } from '../auth/middleware.ts'
import { userWriteRateLimit } from '../auth/rate-limit.ts'
import { hashToken, readSessionToken } from '../auth/session.ts'
import { parseBody, parseId } from '../http.ts'

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

function toSummary(user: Prisma.UserGetPayload<{ select: typeof summaryFields }>): UserSummary {
  return { ...user, createdAt: user.createdAt.toISOString() }
}

const EMAIL_TAKEN = 'A user with that email already exists'
const USER_NOT_FOUND = 'User not found'

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

usersRouter.post('/', userWriteRateLimit, async (req, res) => {
  const body = parseBody(createUserSchema, req, res)
  if (!body) return

  // Lowercased on the way in because login looks the address up lowercased. A
  // row stored with capitals would be unreachable: the agent could never sign in.
  const email = body.email.toLowerCase()

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
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
    if (isPrismaError(err, 'P2002')) {
      res.status(409).json({ error: EMAIL_TAKEN })
      return
    }
    throw err
  }
})

usersRouter.patch('/:id', userWriteRateLimit, async (req, res) => {
  const body = parseBody(updateUserSchema, req, res)
  if (!body) return

  // Checked only to answer early — User.id is TEXT, so a malformed id would
  // reach Postgres and simply miss. The parsed value is used from here on:
  // with a middleware ahead of this handler, Express no longer infers the
  // route's params and types req.params.id as string[] too.
  const id = parseId(z.uuid(), req, res, USER_NOT_FOUND)
  if (id === undefined) return
  const actorId = req.user?.id ?? ''

  // Both parties in one read: who is asking decides as much as who is asked
  // about. requireAuth only carries id, email, name and role, not isProtected.
  const parties = await prisma.user.findMany({
    where: { id: { in: [id, actorId] } },
    select: { id: true, role: true, isProtected: true },
  })
  const target = parties.find((party) => party.id === id)
  const actor = parties.find((party) => party.id === actorId)

  if (!target || !actor) {
    res.status(404).json({ error: USER_NOT_FOUND })
    return
  }

  const { name, email, password, isActive } = body
  const verdict = authorise(actor, target, {
    editsDetails: name !== undefined || email !== undefined || password !== undefined,
    isActive,
  })
  if (!verdict.allowed) {
    res.status(verdict.status).json({ error: verdict.error })
    return
  }

  // Hashed before the transaction, so argon2's ~100ms is not spent holding it.
  const passwordHash = password === undefined ? undefined : await hashPassword(password)

  try {
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: { isActive: true } })

      const updated = await tx.user.update({
        where: { id },
        data: {
          name,
          // Lowercased for the same reason as on create: login looks it up so.
          email: email?.toLowerCase(),
          passwordHash,
          isActive,
        },
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
      if (isActive === false || (isActive === true && before?.isActive === false)) {
        await tx.session.deleteMany({ where: { userId: id } })
      } else if (passwordHash !== undefined) {
        // A password is usually reset because it leaked or was forgotten, so
        // whoever is signed in with the old one is signed out. An admin changing
        // their own keeps the session they are changing it from.
        const token = readSessionToken(req)
        const current = id === actorId && token ? hashToken(token) : undefined
        await tx.session.deleteMany({
          where: { userId: id, ...(current && { tokenHash: { not: current } }) },
        })
      }

      return updated
    })

    res.json(toSummary(user))
  } catch (err) {
    if (isPrismaError(err, 'P2002')) {
      res.status(409).json({ error: EMAIL_TAKEN })
      return
    }
    if (isPrismaError(err, 'P2025')) {
      res.status(404).json({ error: USER_NOT_FOUND })
      return
    }
    throw err
  }
})
