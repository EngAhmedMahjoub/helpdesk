import { createHash, randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../api/src/generated/prisma/client.ts'
import type { Role } from '../api/src/generated/prisma/enums.ts'
import { DATABASE_URL } from './config.ts'

/**
 * Direct access to `helpdesk_e2e` for the setup and assertions no endpoint can
 * do yet: there is no user-creation API until Phase 2, and no way at all to ask
 * the API whether a session row exists.
 *
 * Reach for this only for what the browser cannot reach. The behaviour under
 * test goes through the UI.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
})

/**
 * Mirrors `hashToken` in `apps/api/src/auth/session.ts` rather than importing
 * it. That module pulls in `db.ts` and with it `env.ts`, which calls
 * `process.exit(1)` when the environment lacks the API's variables — and the
 * Playwright runner's environment does, since the API's variables are handed to
 * the `webServer` child process, not to this one.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type NewUser = {
  role?: Role
  isActive?: boolean
  /** Goes into the address, so a failing run says which test left the row. */
  label?: string
}

export type TestUser = {
  id: string
  email: string
  name: string
  password: string
  role: Role
}

/** Not a secret: this database is created, truncated and thrown away by CI. */
const TEST_USER_PASSWORD = 'e2e-user-password-not-a-secret'

/**
 * argon2id hash of TEST_USER_PASSWORD, stored rather than computed.
 *
 * Playwright runs its test files under Node, where `Bun.password` — the API's
 * only hashing implementation — does not exist, so `hashPassword` cannot be
 * imported here. A constant also spares every created user the ~100ms argon2id
 * costs by design.
 *
 * Regenerate with:
 *   bun -e "console.log(await Bun.password.hash('e2e-user-password-not-a-secret'))"
 */
const TEST_USER_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$FhLa0Ew7adbRcrD4gTtfgasA0y98MPm5g2TFGsucYiU$jYEamWRDYEpBOOcJjfU10PKOTxgwhsXRIh6hFpNPwug'

/**
 * An address no other test can collide with. The label goes into it, so a row
 * a failing run leaves behind says which test made it.
 */
export function uniqueEmail(label: string): string {
  return `e2e-${label}-${randomUUID()}@helpdesk.test`
}

/**
 * Creates a user with an address no other test can collide with.
 *
 * The database is prepared once per run, so two tests asking for "an agent"
 * would otherwise fight over one row — and a test that truncated or reused it
 * would break whichever test happened to be mid-assertion.
 */
export async function createUser({
  role = 'agent',
  isActive = true,
  label = 'user',
}: NewUser = {}): Promise<TestUser> {
  const email = uniqueEmail(label)

  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${label}`,
      passwordHash: TEST_USER_PASSWORD_HASH,
      role,
      isActive,
    },
  })

  return { id: user.id, email: user.email, name: user.name, password: TEST_USER_PASSWORD, role }
}

/** Sessions go with the user through the cascade on `Session.userId`. */
export async function deleteUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

/**
 * For users a test had the app create, whose id it never held. Sessions go with
 * them through the same cascade.
 */
export async function deleteUsersByEmail(emails: string[]): Promise<void> {
  if (emails.length === 0) return
  await prisma.user.deleteMany({ where: { email: { in: emails } } })
}

/** Scoped to one address, never a total: other specs' users share this table. */
export function countUsersWithEmail(email: string): Promise<number> {
  return prisma.user.count({ where: { email } })
}

export function setUserActive(id: string, isActive: boolean): Promise<unknown> {
  return prisma.user.update({ where: { id }, data: { isActive } })
}

/** The session a raw cookie value identifies, or null once it is gone. */
export function findSessionByToken(token: string) {
  return prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/**
 * Sessions belonging to one user. Always scope a count to a user the test made
 * itself: the whole run shares this database, so a total is whatever the other
 * specs happen to be doing at the time.
 */
export function countSessionsFor(userId: string): Promise<number> {
  return prisma.session.count({ where: { userId } })
}
