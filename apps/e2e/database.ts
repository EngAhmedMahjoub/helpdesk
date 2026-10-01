import { createHash, randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../api/src/generated/prisma/client.ts'
import type {
  EscalationReason,
  MessageAuthor,
  MessageDirection,
  TicketCategory,
  TicketStatus,
} from '../api/src/generated/prisma/enums.ts'
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
  /** Goes into the address, so a failing run says which test left the row. */
  label?: string
}

export type TestUser = {
  id: string
  email: string
  name: string
  password: string
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
export async function createUser({ label = 'user' }: NewUser = {}): Promise<TestUser> {
  const email = uniqueEmail(label)

  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${label}`,
      passwordHash: TEST_USER_PASSWORD_HASH,
      role: 'agent',
    },
  })

  return { id: user.id, email: user.email, name: user.name, password: TEST_USER_PASSWORD }
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

/**
 * A subject stem no other test can collide with. Every ticket a spec creates
 * starts with its own stem, which is how a spec picks its own rows out of a
 * list it shares with the rest of the run: the list has no search box, so the
 * subject is the only thing a locator can filter on.
 */
export function uniqueSubject(label: string): string {
  return `E2E ${label} ${randomUUID().slice(0, 8)}`
}

export type NewMessage = {
  author: MessageAuthor
  body: string
  /** Required for an agent message and meaningless otherwise: who wrote it. */
  agentId?: string
  /** The thread reads by timestamp, so a seeded one needs its own order. */
  createdAt?: Date
}

export type NewTicket = {
  subject: string
  studentEmail?: string
  studentName?: string
  status?: TicketStatus
  category?: TicketCategory
  summary?: string
  needsAgent?: boolean
  escalationReason?: EscalationReason
  /**
   * Whether the email that opened the ticket passed DMARC. False by default,
   * as in the schema, so a spec that needs the verified case has to say so.
   */
  senderVerified?: boolean
  /** Set explicitly where a spec asserts on sort order; Prisma honours both. */
  createdAt?: Date
  updatedAt?: Date
  messages?: NewMessage[]
}

export type TestTicket = {
  id: number
  subject: string
  studentEmail: string
  studentName: string | null
}

/** A student message arrives, everything else is sent back out. */
function directionOf(author: MessageAuthor): MessageDirection {
  return author === 'student' ? 'inbound' : 'outbound'
}

/**
 * Creates a ticket, with its thread if the spec wants one.
 *
 * No endpoint makes tickets — Phase 4's webhook is what will — so a spec that
 * needs one to look at builds it here. The address defaults to one of its own
 * so two specs cannot end up sharing a student.
 */
export async function createTicket({
  subject,
  studentEmail = uniqueEmail('student'),
  studentName,
  status = 'open',
  category,
  summary,
  needsAgent = false,
  escalationReason,
  senderVerified,
  createdAt,
  updatedAt,
  messages = [],
}: NewTicket): Promise<TestTicket> {
  const ticket = await prisma.ticket.create({
    data: {
      subject,
      studentEmail,
      studentName,
      status,
      category,
      summary,
      needsAgent,
      escalationReason,
      senderVerified,
      createdAt,
      updatedAt,
      messages: {
        create: messages.map((message) => ({
          direction: directionOf(message.author),
          author: message.author,
          agentId: message.agentId,
          body: message.body,
          createdAt: message.createdAt,
          // Null until Phase 4 sends the mail, as the API leaves it.
          emailMessageId: null,
        })),
      },
    },
  })

  return {
    id: ticket.id,
    subject: ticket.subject,
    studentEmail: ticket.studentEmail,
    studentName: ticket.studentName,
  }
}

/** Messages go with the ticket through the cascade on `Message.ticketId`. */
export async function deleteTickets(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.ticket.deleteMany({ where: { id: { in: ids } } })
}

/**
 * Messages on one ticket. Scoped to a ticket the spec made, never a total: the
 * whole run shares this table.
 */
export function countMessagesFor(ticketId: number): Promise<number> {
  return prisma.message.count({ where: { ticketId } })
}

/**
 * The id behind an address, for the agent a seeded reply is attributed to.
 * `Message.agentId` is Restrict, so only a user nothing deletes — the seeded
 * admin — can safely author one.
 */
export async function userIdFor(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  return user.id
}

export type TestDraft = {
  id: number
  body: string
}

/**
 * A pending AI draft on a ticket the spec made. Written straight to the table:
 * the only thing that makes one is the AI pipeline, and no spec may reach
 * Anthropic. It goes with its ticket through the cascade on `ReplyDraft.ticketId`.
 */
export async function createDraft(ticketId: number, body: string): Promise<TestDraft> {
  const draft = await prisma.replyDraft.create({ data: { ticketId, body } })
  return { id: draft.id, body: draft.body }
}

/**
 * Rewrites a draft as the AI does after a student's follow-up. Prisma's
 * `@updatedAt` moves the version with it, which is what makes an approval of
 * the old text stale.
 */
export async function rewriteDraft(id: number, body: string): Promise<void> {
  await prisma.replyDraft.update({ where: { id }, data: { body } })
}

/** A draft's review state, for what the page cannot show once the panel is gone. */
export function findDraft(id: number) {
  return prisma.replyDraft.findUniqueOrThrow({
    where: { id },
    select: { status: true, body: true, reviewedById: true },
  })
}
