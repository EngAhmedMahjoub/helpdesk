import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env.ts'
import { Prisma, PrismaClient } from './generated/prisma/client.ts'

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
})

/** True for a Prisma error with this code, e.g. P2002 (unique) or P2025 (no row). */
export function isPrismaError(
  err: unknown,
  code: 'P2002' | 'P2025',
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
}

/**
 * A user as other rows name them — a ticket's assignee, a message's agent, a
 * draft's reviewer — by id and name only, never the rest of their row: the
 * email, role and password hash stay out of every response that names someone.
 */
export const userNameFields = { id: true, name: true } satisfies Prisma.UserSelect
